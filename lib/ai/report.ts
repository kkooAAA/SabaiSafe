// Report Assistant pipelines (contracts §3.2 / §3.3). Server-only.
//
//   interview: scrubConversation → reportInterviewSystem(lang) on chatModel → guardAnswer (phone numbers) →
//              textStreamResponse(ready: true), so "[READY]" only ever appears as the final "\n[READY]".
//   generate:  scrubConversation → transcript → REPORT_EXTRACT_SYSTEM on fastModel (temperature 0) →
//              ReportFacts (one retry on invalid JSON) → scrubDeep → REPORT_THAI_SYSTEM on chatModel →
//              normalizeReportMarkdown (exact two headings, valid GFM; one retry) → scrubPII. Nothing is stored.
import { generateText, streamText, type ModelMessage } from "ai";
import { READY_TOKEN, ReportFacts, type ChatMessage, type ReportGenerateResponse, type UiLang } from "@/types/api";
import { guardAnswer } from "./answer-guard";
import { EXTRACT_RETRY_MESSAGE } from "./constants";
import { REPORT_EXTRACT_SYSTEM, REPORT_THAI_SYSTEM, reportInterviewSystem } from "./prompts";
import { chatModel, fastModel, modelCallOptions } from "./provider";
import { scrubDeep, scrubPII } from "./scrub";
import { textDeltas, textStreamResponse, primeDeltas } from "./stream";

export const REPORT_HEADING_TH = "## ฉบับภาษาไทย (สำหรับเจ้าหน้าที่)";
export const REPORT_HEADING_EN = "## English translation (for you to check)";

/** Thrown when the model's output can't be used after the retry. Routes map it to 500 `internal`. */
export class ReportGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportGenerationError";
  }
}

/**
 * PII never reaches the model: every message is scrubbed (passport, phone, email). Assistant turns come back from
 * the client, so they are scrubbed too, and a stray "[READY]" or \u001e marker in them is removed.
 */
export function scrubConversation(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    let content = scrubPII(m.content.replace(/\u001e/g, ""));
    if (m.role === "assistant") content = content.split(READY_TOKEN).join("").trimEnd();
    return { role: m.role, content };
  });
}

/** True when the conversation starts and ends with a user message (contracts §3.2). */
export function startsAndEndsWithUser(messages: ChatMessage[]): boolean {
  return messages[0]?.role === "user" && messages[messages.length - 1]?.role === "user";
}

// ------------------------------------------------------------------ interview

/** Streams the next interview message. Model setup errors (missing key) throw before streaming starts. */
export async function interviewResponse(messages: ChatMessage[], lang: UiLang, signal?: AbortSignal): Promise<Response> {
  const model = chatModel();
  const history: ModelMessage[] = scrubConversation(messages)
    .filter((m) => m.content.trim() !== "")
    .map((m) => ({ role: m.role, content: m.content }));
  const result = streamText({
    ...modelCallOptions(),
    model,
    system: reportInterviewSystem(lang),
    messages: history,
    temperature: 0.3,
    maxOutputTokens: 400,
    abortSignal: signal,
  });
  return textStreamResponse(guardAnswer(await primeDeltas(textDeltas(result.stream))), {
    ready: true,
    onError: (err) => console.error("[/api/report/chat] stream failed", err),
  });
}

// ------------------------------------------------------------------ generate

/** The conversation as one block of text for the extractor. Each message is on one line. */
export function transcript(messages: ChatMessage[]): string {
  const lines = messages
    .filter((m) => m.content.trim() !== "")
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.replace(/\s*\n\s*/g, " ").trim()}`);
  return `CONVERSATION (User = the tourist, Assistant = SabaiSafe):\n${lines.join("\n")}`;
}

function stripFences(text: string): string {
  const t = text.trim();
  const m = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/.exec(t);
  return m ? m[1]! : t;
}

/** Parses the extractor's reply into ReportFacts, or null (prose around the JSON and code fences are tolerated). */
export function parseFactsJson(text: string): ReportFacts | null {
  const t = stripFences(text);
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = ReportFacts.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function extractFacts(messages: ChatMessage[], signal?: AbortSignal): Promise<ReportFacts> {
  const model = fastModel();
  const history: ModelMessage[] = [{ role: "user", content: transcript(scrubConversation(messages)) }];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text } = await generateText({
      ...modelCallOptions(),
      model,
      system: REPORT_EXTRACT_SYSTEM,
      messages: history,
      temperature: 0,
      maxOutputTokens: 1200,
      abortSignal: signal,
    });
    const facts = parseFactsJson(text);
    if (facts) return scrubDeep(facts);
    history.push({ role: "assistant", content: text || "(empty)" }, { role: "user", content: EXTRACT_RETRY_MESSAGE });
  }
  throw new ReportGenerationError("Fact extraction returned invalid JSON twice");
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const HEADING_TEXT = [REPORT_HEADING_TH, REPORT_HEADING_EN].map((h) => h.slice(3));

/**
 * Normalizes the Thai summary to valid GFM, or returns null if the two exact headings aren't there once each,
 * Thai first. Strips code fences and CRLF, accepts the heading text at any heading level (bolded, or as a plain
 * line) and rewrites it
 * as "## ...", demotes any other heading to a bold line, and puts a blank line between label lines so "**เรื่อง:** ...\n**ผู้แจ้ง:** ..." don't merge
 * into one paragraph. Consecutive list items stay together.
 */
export function normalizeReportMarkdown(text: string): string | null {
  const lines = stripFences(text.replace(/\r\n?/g, "\n"))
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""));
  const out: string[] = [];
  for (const line of lines) {
    const bare = line
      .replace(/^\s*#{1,6}\s*/, "")
      .replace(/^\*\*(.+)\*\*$/, "$1")
      .trim();
    const isHeading = HEADING_TEXT.includes(bare);
    // Any other heading is demoted to a bold line, so the document has exactly the two contract headings.
    const other = isHeading ? null : /^\s*#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    const cur = isHeading ? `## ${bare}` : other ? (other[1] ? `**${other[1].replace(/\*\*/g, "")}**` : "") : line;
    if (cur.trim() === "") {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    const prev = out[out.length - 1];
    const keepTogether = prev !== undefined && LIST_ITEM.test(prev) && (LIST_ITEM.test(cur) || /^\s{2,}\S/.test(cur));
    if (prev !== undefined && prev !== "" && !keepTogether) out.push("");
    out.push(cur);
    if (isHeading) out.push("");
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  while (out.length && out[0] === "") out.shift();
  const md = out.join("\n");
  const th = out.filter((l) => l === REPORT_HEADING_TH).length;
  const en = out.filter((l) => l === REPORT_HEADING_EN).length;
  if (th !== 1 || en !== 1 || out.indexOf(REPORT_HEADING_TH) > out.indexOf(REPORT_HEADING_EN)) return null;
  return `${md}\n`;
}

export async function writeThaiSummary(facts: ReportFacts, signal?: AbortSignal): Promise<string> {
  const model = chatModel();
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text } = await generateText({
      ...modelCallOptions(),
      model,
      system: REPORT_THAI_SYSTEM,
      prompt: `FACTS (JSON):\n${JSON.stringify(facts, null, 2)}`,
      temperature: 0.2,
      maxOutputTokens: 2500,
      abortSignal: signal,
    });
    const md = normalizeReportMarkdown(text);
    if (md) return scrubPII(md);
  }
  throw new ReportGenerationError("Thai summary is missing the required headings");
}

/** Full generate pipeline. Nothing is stored. */
export async function generateReport(messages: ChatMessage[], signal?: AbortSignal): Promise<ReportGenerateResponse> {
  // Resolve both models first, so a missing key is a 503 before any paid call.
  chatModel();
  fastModel();
  const facts = await extractFacts(messages, signal);
  const markdown = await writeThaiSummary(facts, signal);
  return { facts, markdown };
}
