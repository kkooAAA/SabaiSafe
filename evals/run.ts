// Legal Guide eval (contracts §7, task P2-5). Usage:
//   pnpm eval                         in-process: imports POST from app/api/chat/route.ts
//   pnpm eval -- --url http://localhost:3000   against a running app (real keys live in the app; retries on 429)
//   --shape-only   skip the retrieval gates (e.g. --url against a server running AI_PROVIDER=mock)
//   --report       run the Report Assistant eval instead (evals/report.ts; scripted interviews → generate → PDF)
//   options: --lang en|zh  --only en-01,zh-03  --out evals/results/x.json  --min-hit 0.8  --delay 0
//
// Mode: if AI_PROVIDER=mock, or no ANTHROPIC/OPENAI key is set, the in-process run uses AI_PROVIDER=mock and
// prints "MOCK". Mock answers are canned, so the retrieval scores are NOT a quality measure in mock mode;
// the shape gates (stream complete, trailer, disclaimer, citations,
// language, no invented numbers) still run. Mock retrieval is lexical (hashed-token embeddings over content/legal,
// lib/ai/legal-index.ts), so its hit-rate is a rough sanity signal only. Real mode also gates on --min-hit.
// Env is read from .env.local / .env (dotenv) before anything imports lib/ai.
import { config as loadEnv } from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { hardFailures, scoreAnswer, summarize, type EvalQuestion, type QuestionScore } from "./score";

loadEnv({ path: [".env.local", ".env"], quiet: true });

type Args = { shapeOnly?: boolean; report?: boolean; url?: string; lang?: string; only?: string[]; out: string; minHit: number; delay: number };

function parseArgs(argv: string[]): Args {
  const a: Args = { out: join("evals", "results", "latest.json"), minHit: 0.8, delay: 0 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--shape-only") {
      a.shapeOnly = true;
      continue;
    }
    if (k === "--report") {
      a.report = true;
      continue;
    }
    if (v === undefined) continue;
    let used = true;
    if (k === "--url") a.url = v.replace(/\/$/, "");
    else if (k === "--lang") a.lang = v;
    else if (k === "--only") a.only = v.split(",");
    else if (k === "--out") a.out = v;
    else if (k === "--min-hit") a.minHit = Number(v);
    else if (k === "--delay") a.delay = Number(v);
    else used = false;
    if (used) i++;
  }
  return a;
}

export function loadQuestions(file = join(process.cwd(), "evals", "questions.jsonl")): EvalQuestion[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as EvalQuestion);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let mock = false;
  if (!args.url) {
    const p = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
    const hasKeys = !!process.env.OPENAI_API_KEY && (p === "openai" || !!process.env.ANTHROPIC_API_KEY);
    if (p === "mock" || !hasKeys) {
      process.env.AI_PROVIDER = "mock";
      mock = true;
    }
  }

  if (args.report) {
    const { runReportEval } = await import("./report");
    const gates = await runReportEval({ url: args.url, mock });
    if (gates.length) {
      console.log(`GATES FAILED:\n  - ${gates.join("\n  - ")}`);
      process.exitCode = 1;
    } else console.log("All gates passed.");
    return;
  }

  let questions = loadQuestions();
  if (args.lang) questions = questions.filter((q) => q.lang === args.lang);
  if (args.only) questions = questions.filter((q) => args.only!.includes(q.id));

  // Imported after env is set so lib/ai sees the final AI_PROVIDER.
  const route = args.url ? null : await import("@/app/api/chat/route");
  const ask = async (q: EvalQuestion): Promise<{ status: number; body: string }> => {
    const question = q.question;
    const init: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
      body: JSON.stringify({ question, lang: q.lang }),
    };
    if (route) {
      const res = await route.POST(new Request("http://localhost/api/chat", init));
      return { status: res.status, body: await res.text() };
    }
    // HTTP mode goes through middleware (RATE_LIMIT_AI_PER_MIN, default 15/min): wait and retry on 429.
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${args.url}/api/chat`, init);
      if (res.status !== 429 || attempt >= 5) return { status: res.status, body: await res.text() };
      await res.body?.cancel();
      const wait = Math.min(Math.max(Number(res.headers.get("retry-after")) || 10, 1), 65) * 1000;
      console.log(`  429 on ${q.id}, waiting ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  };

  console.log(`SabaiSafe Legal Guide eval: ${questions.length} questions, mode ${args.url ? `HTTP ${args.url}` : mock ? "MOCK (in-process)" : `REAL in-process (${process.env.AI_PROVIDER || "anthropic"})`}`);
  const scores: QuestionScore[] = [];
  for (const q of questions) {
    let s: QuestionScore;
    try {
      const { status, body } = await ask(q);
      s = scoreAnswer(q, status, body);
    } catch (e) {
      s = scoreAnswer(q, 0, "");
      s.failures.unshift(`threw: ${(e as Error).message}`);
    }
    scores.push(s);
    console.log(`${s.failures.length ? "FAIL" : "ok  "} ${q.id.padEnd(6)} ${s.source_slugs.slice(0, 3).join(",") || "-"}${s.failures.length ? `  <- ${s.failures.join("; ")}` : ""}`);
    if (args.delay > 0) await new Promise((r) => setTimeout(r, args.delay));
  }

  const sum = summarize(scores);
  const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(0)}%`);
  console.log("\nSummary");
  console.log(`  retrieval hit-rate   ${pct(sum.hit_rate)} (en ${pct(sum.by_lang.en.hit_rate)}, zh ${pct(sum.by_lang.zh.hit_rate)}), MRR ${sum.mrr.toFixed(2)}${mock ? "  [mock: not meaningful]" : ""}`);
  console.log(`  in-scope no-answer   ${pct(sum.no_answer_rate_in_scope)}`);
  console.log(`  out-of-scope refused ${pct(sum.oos_no_answer_rate)}`);
  console.log(`  disclaimer           ${pct(sum.disclaimer_rate)}`);
  console.log(`  citations            ${pct(sum.citation_rate)}`);
  console.log(`  invented numbers     ${sum.invented_number_answers} answers`);
  console.log(`  correct language     ${pct(sum.language_rate)}`);
  console.log(`  emergency flagged    ${pct(sum.emergency_rate)}`);
  console.log(`  complete streams     ${pct(sum.complete_rate)}`);

  const gates = hardFailures(sum);
  if (!mock && !args.shapeOnly) {
    if (sum.hit_rate < args.minHit) gates.push(`hit_rate ${pct(sum.hit_rate)} < ${pct(args.minHit)}`);
    if (sum.oos_no_answer_rate < 0.5) gates.push(`out-of-scope refused ${pct(sum.oos_no_answer_rate)} < 50%`);
  }

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify({ at: new Date().toISOString(), mock, url: args.url ?? null, summary: sum, gates, scores }, null, 2));
  console.log(`\nResults: ${args.out}`);
  if (gates.length) {
    console.log(`GATES FAILED:\n  - ${gates.join("\n  - ")}`);
    process.exitCode = 1;
  } else console.log("All gates passed.");
}

const isEntry = process.argv[1] && /evals[\\/]run\.ts$/.test(process.argv[1]);
if (isEntry) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
