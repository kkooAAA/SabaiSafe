// Report Assistant eval (contracts §3.2–3.4): scripted interviews → generate → PDF.
//   pnpm eval -- --report                       in-process (mock without keys: a cheap wire/PII smoke test)
//   pnpm eval -- --report --url http://localhost:3000   against a running app (real model behaviour)
// Hard gates: [READY] only as the exact final "\n[READY]" and never before the user's confirmation; generate returns
// exactly the two §3.3 headings; no passport/phone/email from the script in facts or markdown; no invented phone
// numbers (only the four hotlines); the PDF is a PDF. Soft metric: share of scripts that reached [READY].
import { READY_TOKEN, ERROR_MARKER } from "@/types/protocol";
import type { ChatMessage, UiLang } from "@/types/api";
import { inventedNumbers } from "../tests/helpers/phones";
import { EN_HEADING, PII, TH_HEADING, leakedPii } from "../tests/helpers/report";

export type Scenario = { id: string; lang: UiLang; turns: string[] };

/** The last turn is always the confirmation of the read-back. */
export const SCENARIOS: Scenario[] = [
  {
    id: "en-jetski",
    lang: "en",
    turns: [
      `Yesterday around 4pm at Patong Beach a jet ski operator said I scratched the jet ski and demanded 30,000 baht. They kept my passport ${PII.passportToken} as a deposit. My phone is ${PII.thaiMobile}.`,
      "The stand is near the south end of the beach. A man in a blue shirt. I have photos of the jet ski before I rode it. I want my passport back.",
      "I don't know his name. My friend saw everything. I paid nothing yet. I am Australian.",
      "Yes, that is correct.",
    ],
  },
  {
    id: "en-taxi",
    lang: "en",
    turns: [
      `A taxi from the airport to Kata charged me 2,500 baht on 18 November around 11pm. Email me at ${PII.email}.`,
      "No meter was used. I paid cash and have a photo of the car plate. I would like a refund.",
      "I am British. No witnesses.",
      "Yes, correct.",
    ],
  },
  {
    id: "zh-scooter",
    lang: "zh",
    turns: [
      `昨天下午在芭东租的摩托车，还车时老板说有划痕，要我赔 8,000 泰铢，还扣了我的护照 ${PII.passportZh}。我的电话是 ${PII.cnMobile}。`,
      "店在芭东海滩路上。租车前我拍了照片。我想拿回护照。",
      "我不知道老板的名字。我是中国人。没有证人。",
      "是的，没错。",
    ],
  },
];

export type ScenarioScore = {
  id: string;
  lang: UiLang;
  ready_at: number | null; // turn index (0-based) whose reply ended with [READY]
  failures: string[];
};

/** Checks one interview reply. `isConfirmTurn` = the user just confirmed the read-back. */
export function checkReply(body: string, isConfirmTurn: boolean): { ready: boolean; failures: string[] } {
  const failures: string[] = [];
  if (body.includes(ERROR_MARKER)) failures.push("stream ended with ERROR_MARKER");
  const count = body.split(READY_TOKEN).length - 1;
  const ready = count > 0 && body.endsWith(`\n${READY_TOKEN}`);
  if (count > 1) failures.push("[READY] appears more than once");
  if (count > 0 && !ready) failures.push("[READY] not as the exact final \\n[READY]");
  if (ready && !isConfirmTurn) failures.push("[READY] before the user confirmed");
  if (body.includes("\u001e") && !body.includes(ERROR_MARKER)) failures.push("stray \\u001e");
  return { ready, failures };
}

/** Checks the generate response and the markdown. */
export function checkGenerate(status: number, json: unknown): string[] {
  if (status !== 200) return [`generate HTTP ${status}`];
  const r = json as { facts?: unknown; markdown?: unknown };
  if (typeof r?.markdown !== "string" || !r.facts) return ["generate: missing facts/markdown"];
  const f: string[] = [];
  const headings = r.markdown.split("\n").filter((l) => /^#{1,6}\s/.test(l));
  if (JSON.stringify(headings) !== JSON.stringify([TH_HEADING, EN_HEADING])) f.push(`headings: ${JSON.stringify(headings)}`);
  const leaks = [...leakedPii(JSON.stringify(r.facts)), ...leakedPii(r.markdown)];
  if (leaks.length) f.push(`PII leaked: ${[...new Set(leaks)].join(", ")}`);
  const invented = inventedNumbers(r.markdown);
  if (invented.length) f.push(`invented numbers: ${invented.join(", ")}`);
  if (r.markdown.includes(READY_TOKEN)) f.push("[READY] in the summary");
  return f;
}

type Post = (path: string, body: unknown) => Promise<Response>;

export async function runScenario(s: Scenario, post: Post): Promise<ScenarioScore & { pdf_ok: boolean | null }> {
  const score: ScenarioScore & { pdf_ok: boolean | null } = { id: s.id, lang: s.lang, ready_at: null, failures: [], pdf_ok: null };
  const messages: ChatMessage[] = [];
  for (let i = 0; i < s.turns.length && score.ready_at === null; i++) {
    messages.push({ role: "user", content: s.turns[i]! });
    const res = await post("/api/report/chat", { messages, lang: s.lang });
    const body = await res.text();
    if (res.status !== 200) {
      score.failures.push(`chat turn ${i} HTTP ${res.status}`);
      return score;
    }
    const c = checkReply(body, i === s.turns.length - 1);
    score.failures.push(...c.failures.map((x) => `turn ${i}: ${x}`));
    if (c.ready) score.ready_at = i;
    const visible = body.replace(`\n${READY_TOKEN}`, "").trim();
    if (visible) messages.push({ role: "assistant", content: visible.slice(0, 4000) });
  }
  const gen = await post("/api/report/generate", { messages });
  const json: unknown = await gen.json().catch(() => null);
  const gf = checkGenerate(gen.status, json);
  score.failures.push(...gf);
  if (gen.status === 200) {
    const pdf = await post("/api/report/pdf", json);
    const head = new TextDecoder().decode(new Uint8Array(await pdf.arrayBuffer()).slice(0, 5));
    score.pdf_ok = pdf.status === 200 && pdf.headers.get("content-type") === "application/pdf" && head === "%PDF-";
    if (!score.pdf_ok) score.failures.push(`pdf HTTP ${pdf.status} / ${head}`);
  }
  return score;
}

/** Entry from evals/run.ts (`--report`). Returns the hard-gate failures. */
export async function runReportEval(opts: { url?: string; mock: boolean }): Promise<string[]> {
  const routes = opts.url
    ? null
    : {
        "/api/report/chat": (await import("@/app/api/report/chat/route")).POST,
        "/api/report/generate": (await import("@/app/api/report/generate/route")).POST,
        "/api/report/pdf": (await import("@/app/api/report/pdf/route")).POST,
      };
  const post: Post = async (path, body) => {
    const init: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
      body: JSON.stringify(body),
    };
    if (routes) return routes[path as keyof typeof routes](new Request(`http://localhost${path}`, init));
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${opts.url}${path}`, init);
      if (res.status !== 429 || attempt >= 5) return res;
      await res.body?.cancel();
      await new Promise((r) => setTimeout(r, Math.min(Math.max(Number(res.headers.get("retry-after")) || 10, 1), 65) * 1000));
    }
  };

  console.log(`SabaiSafe Report eval: ${SCENARIOS.length} scripts, mode ${opts.url ? `HTTP ${opts.url}` : opts.mock ? "MOCK (in-process)" : "REAL in-process"}`);
  const scores = [];
  for (const s of SCENARIOS) {
    const r = await runScenario(s, post).catch((e: Error) => ({ id: s.id, lang: s.lang, ready_at: null, pdf_ok: null, failures: [`threw: ${e.message}`] }));
    scores.push(r);
    console.log(`${r.failures.length ? "FAIL" : "ok  "} ${r.id.padEnd(11)} ready@${r.ready_at ?? "-"} pdf ${r.pdf_ok ?? "-"}${r.failures.length ? `  <- ${r.failures.join("; ")}` : ""}`);
  }
  const reached = scores.filter((s) => s.ready_at !== null).length;
  console.log(`  reached [READY]      ${reached}/${scores.length}${opts.mock ? "  [mock: READY only on the confirm turn by design]" : ""}`);
  const gates = scores.flatMap((s) => s.failures.map((f) => `${s.id}: ${f}`));
  if (opts.mock && reached !== scores.length) gates.push("mock: every script must reach [READY]");
  return gates;
}
