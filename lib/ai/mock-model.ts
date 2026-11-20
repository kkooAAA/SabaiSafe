// Canned responses for AI_PROVIDER=mock. See the MOCK MODE block in lib/ai/provider.ts for the behaviour spec.
import type { MockLanguageModelV4 } from "ai/test";
import {
  DISCLAIMER,
  QUERY_REWRITE_SYSTEM,
  REPORT_EXTRACT_SYSTEM,
  REPORT_THAI_SYSTEM,
  ROUTER_SYSTEM,
  fairPriceSystem,
  legalGuideSystem,
  reportInterviewSystem,
  type Lang,
} from "./prompts";
import { EXTRACT_RETRY_MESSAGE, VERDICT_ZH, computeVerdict, type PriceVerdict } from "./constants";
import { MOCK_CONFIRM_RE, MOCK_EMERGENCY_RE, MOCK_TRIGGERS } from "./mock-fixtures";

// @ai-sdk/provider is not a direct dependency, so derive the V4 types from the mock class.
type LanguageModelV4GenerateResult = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
type LanguageModelV4StreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type LanguageModelV4Prompt = Parameters<MockLanguageModelV4["doGenerate"]>[0]["prompt"];

type MockReply = { generate(): Promise<LanguageModelV4GenerateResult>; stream(): Promise<LanguageModelV4StreamResult> };

const LANGS: Lang[] = ["en", "zh", "th"];

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

function partText(m: LanguageModelV4Prompt[number]): string {
  if (typeof m.content === "string") return m.content;
  return m.content.map((p) => (p.type === "text" ? p.text : "")).join("");
}

/** Splits text into small chunks (so tokens like "[READY]" arrive split across chunks). */
function chunk(text: string, size = 5): string[] {
  const out: string[] = [];
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(""));
  return out;
}

function reply(text: string, failAfterFirstChunk: boolean): MockReply {
  return {
    async generate() {
      if (failAfterFirstChunk) throw new Error("mock model error (STREAMERROR)");
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      };
    },
    async stream() {
      const parts = chunk(text);
      const stream = new ReadableStream({
        start(c) {
          c.enqueue({ type: "stream-start", warnings: [] });
          c.enqueue({ type: "text-start", id: "t0" });
          for (let i = 0; i < parts.length; i++) {
            c.enqueue({ type: "text-delta", id: "t0", delta: parts[i]! });
            if (failAfterFirstChunk && i === 0) {
              c.enqueue({ type: "error", error: new Error("mock stream error (STREAMERROR)") });
              c.close();
              return;
            }
          }
          c.enqueue({ type: "text-end", id: "t0" });
          c.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
          c.close();
        },
      });
      return { stream };
    },
  };
}

const TOPIC_KEYWORDS: [RegExp, string][] = [
  [/rent|motorbike|scooter|jet ?ski|deposit|租|摩托|押金/i, "rental"],
  [/taxi|tuk|grab|driver|fare|出租|嘟嘟/i, "transport"],
  [/price|overcharg|expensive|价格|太贵/i, "price"],
  [/scam|fraud|cheat|骗/i, "scam"],
  [/drug|cannabis|weed|alcohol|vape|毒|大麻|酒/i, "alcohol_drugs"],
  [/beach|swim|flag|海滩|游泳/i, "beach_rules"],
  [/hotel|hostel|airbnb|酒店/i, "accommodation"],
  [/visa|immigration|overstay|签证/i, "visa_immigration"],
  [/police|report|arrest|警察|报案/i, "police_procedure"],
];

function rewriteJson(q: string): string {
  const topic = TOPIC_KEYWORDS.find(([re]) => re.test(q))?.[1] ?? "other";
  return JSON.stringify({
    search_query: q.slice(0, 200),
    user_lang: /[一-鿿]/.test(q) ? "zh" : /[฀-๿]/.test(q) ? "th" : "en",
    location: /patong|芭东/i.test(q) ? "Patong Beach" : null,
    topic,
    is_emergency: MOCK_EMERGENCY_RE.test(q),
  });
}

/** Source ids given in the user prompt ("[n] title ..." lines under SOURCES:). */
function sourceIds(userText: string): number[] {
  const block = userText.split("\nQUESTION:\n")[0] ?? "";
  return [...block.matchAll(/^\[(\d+)\] /gm)].map((m) => Number(m[1]));
}

/** Cites [1] and, only if it was given, [2], so mock answers never carry a dangling citation. */
function legalAnswer(lang: Lang, ids: number[]): string {
  const c1 = ids.includes(1) ? " [1]" : "";
  const c2 = ids.includes(2) ? " [2]" : "";
  if (lang === "zh")
    return `模拟回答：根据资料，租车押金和损坏索赔有相关规定${c1}。如需报案，可联系旅游警察${c2}。\n\n**您可以怎么做**\n- 保留收据和照片。\n- 拨打 1155。\n\n${DISCLAIMER.zh}`;
  return `Mock answer: the sources describe rules on rental deposits and damage claims${c1}. You can report to the Tourist Police${c2}.\n\n**What you can do**\n- Keep receipts and photos.\n- Call 1155.\n\n${DISCLAIMER.en}`;
}

const MOCK_QUESTIONS: Record<"en" | "zh", string[]> = {
  en: [
    "Mock question 1: When did this happen (date and approximate time)?",
    "Mock question 2: Where did it happen?",
    "Mock question 3: Who was involved, and how much money was lost or demanded?",
  ],
  zh: [
    "模拟问题 1：这件事是什么时候发生的（日期和大概时间）？",
    "模拟问题 2：事情发生在哪里？",
    "模拟问题 3：涉及哪些人？损失或被索要了多少钱？",
  ],
};

/** Scripted interview: 3 questions, then a read-back of the first user message, then [READY] on "yes". */
function interview(prompt: LanguageModelV4Prompt, lang: Lang): string {
  const l = lang === "zh" ? "zh" : "en";
  const users = prompt.filter((m) => m.role === "user").map(partText);
  const last = users[users.length - 1] ?? "";
  if (MOCK_CONFIRM_RE.test(last)) {
    return l === "zh"
      ? "谢谢确认。您现在可以创建说明。\n[READY]"
      : "Thank you for confirming. You can now create the summary.\n[READY]";
  }
  const q = MOCK_QUESTIONS[l][users.length - 1];
  if (q) return q;
  const first = (users[0] ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  return l === "zh" ? `模拟复述：我记录的是：${first}。这样对吗？` : `Mock read-back: I noted that ${first}. Is this correct?`;
}

/** Echoes the "User: ..." lines of the transcript (not assistant turns, not the retry instruction). */
function extractJson(userText: string, isRetry: boolean): string {
  if (userText.includes(MOCK_TRIGGERS.badJsonAlways)) return "this is not JSON {";
  if (userText.includes(MOCK_TRIGGERS.badJsonOnce) && !isRetry) return "```json\n{ broken";
  const said = [...userText.matchAll(/^User: (.*)$/gm)].map((m) => m[1]!.trim()).join(" ");
  return JSON.stringify({
    incident_type: "other",
    incident_summary_en: said.replace(/\s+/g, " ").trim().slice(0, 600),
    date: null,
    time: null,
    location: null,
    parties: [],
    money: { amount: null, currency: null, type: null, payment_method: null },
    evidence: [],
    witnesses: null,
    user_goal: null,
    reporter: { nationality: null, name: null },
  });
}

function thaiSummary(userText: string): string {
  let summary = "ไม่ทราบ";
  try {
    const facts = JSON.parse(userText.slice(userText.indexOf("{"))) as { incident_summary_en?: unknown };
    if (typeof facts.incident_summary_en === "string") summary = facts.incident_summary_en;
  } catch {
    /* keep default */
  }
  return [
    "## ฉบับภาษาไทย (สำหรับเจ้าหน้าที่)",
    "**เรื่อง:** สรุปเหตุการณ์เพื่อประกอบการแจ้งความ",
    "**ผู้แจ้ง:** ไม่ประสงค์ระบุ สัญชาติ ไม่ทราบ",
    "**ประเภทเหตุการณ์:** อื่น ๆ",
    "**วันและเวลาที่เกิดเหตุ:** ไม่ทราบ",
    "**สถานที่เกิดเหตุ:** ไม่ทราบ",
    `**รายละเอียดเหตุการณ์:** ผู้แจ้งระบุว่า ${summary}`,
    "",
    "หมายเหตุ: เอกสารนี้จัดทำโดยผู้แจ้งด้วยความช่วยเหลือของระบบ SabaiSafe เพื่อใช้ประกอบการให้ข้อมูลแก่เจ้าหน้าที่เท่านั้น มิใช่บันทึกประจำวันหรือเอกสารทางราชการ",
    "",
    "## English translation (for you to check)",
    "**Subject:** Incident summary to support a police report",
    "**Reporter:** Prefers not to say, nationality unknown",
    "**Incident type:** Other",
    "**Date and time:** Unknown",
    "**Location:** Unknown",
    `**Details:** The reporter states that ${summary}`,
  ].join("\n");
}

function priceAnswer(userText: string, lang: Lang): string {
  const quotedMatch = /QUOTED PRICE:\s*([\d.]+)\s*THB/.exec(userText);
  const quoted = quotedMatch ? Number(quotedMatch[1]) : null;
  const maxima = [...userText.matchAll(/:\s*[\d.]+–([\d.]+) THB/g)].map((m) => Number(m[1]));
  const given = /COMPUTED VERDICT:\s*(.+)/.exec(userText)?.[1]?.trim() as PriceVerdict | undefined;
  const verdict: PriceVerdict = given && given in VERDICT_ZH ? given : computeVerdict(quoted, maxima);
  // First reference line: "- item (area): min–max THB unit; source: S; collected D[; LEGALLY FIXED PRICE]"
  const ref = /^- .+?: ([\d.]+)–([\d.]+) THB (.+?); source: (.+?); collected ([^;\n]+)/m.exec(userText);
  const range = ref ? `${ref[1]}–${ref[2]} THB ${ref[3]} (${ref[4]}, ${ref[5]})` : "";
  if (lang === "zh")
    return `结论：${VERDICT_ZH[verdict]} (${verdict})\n\n${range ? `常见价格：${range}\n\n` : ""}模拟说明：请事先谈好价格并索取收据。如感到被强迫，可拨打 1166 或 1155。`;
  return `Verdict: ${verdict}\n\n${range ? `Typical: ${range}\n\n` : ""}Mock explanation: agree the price before the service and ask for a receipt. If you feel pressured, call 1166 or Tourist Police 1155.`;
}

export function mockRespond(prompt: LanguageModelV4Prompt): MockReply {
  const system = prompt
    .filter((m) => m.role === "system")
    .map(partText)
    .join("\n");
  const userMsgs = prompt.filter((m) => m.role === "user").map(partText);
  const userText = userMsgs.join("\n");
  const fail = userText.includes(MOCK_TRIGGERS.streamError);
  const langOf = (fn: (l: Lang) => string) => LANGS.find((l) => system === fn(l));

  if (system === QUERY_REWRITE_SYSTEM) return reply(rewriteJson(userText), fail);
  if (system === ROUTER_SYSTEM) return reply(JSON.stringify({ feature: "legal", reason: "mock" }), fail);
  if (system === REPORT_EXTRACT_SYSTEM)
    return reply(extractJson(userText, userMsgs.some((m) => m.includes(EXTRACT_RETRY_MESSAGE))), fail);
  if (system === REPORT_THAI_SYSTEM) return reply(thaiSummary(userText), fail);

  const legal = langOf(legalGuideSystem);
  if (legal) return reply(legalAnswer(legal, sourceIds(userText)), fail);
  const interviewLang = langOf(reportInterviewSystem);
  if (interviewLang) return reply(interview(prompt, interviewLang), fail);
  const price = langOf(fairPriceSystem);
  if (price) return reply(priceAnswer(userText, price), fail);

  return reply("Mock response.", fail);
}
