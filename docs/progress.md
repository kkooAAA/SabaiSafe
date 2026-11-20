# Progress log

Newest first. One short entry per finished task: date, teammate, what changed, how it was checked.

## 2026-11-20 — ai — P3-1 report chat/generate, P3-2 PDF/save/get/delete (done, qa approved)
- `lib/ai/report.ts`: every message scrubPII'd before the model; interview = reportInterviewSystem → guardAnswer →
  ready-mode stream (`\n[READY]` only as final bytes); generate = transcript → REPORT_EXTRACT_SYSTEM (fast, temp 0,
  ReportFacts zod, one retry) → scrubDeep → REPORT_THAI_SYSTEM → normalizeReportMarkdown (exactly the two §3.3
  headings, others demoted to bold, GFM paragraphs; one retry) → scrubPII. Nothing stored.
- Routes `app/api/report/{chat,generate,pdf,save,[id]}`: chat needs first+last user; generate needs first user (last
  may be the READY reply, contracts v0.4); save checks consent literal → `consent_required`, version →
  `consent_outdated`, re-scrubs, `saveReport` → 201; GET/DELETE need `x-delete-token` (missing ⇒ 404 without DB).
- `lib/pdf/render.ts`: pdfkit, own line wrapper (Intl.Segmenter("th") words, grapheme fallback), Sarabun for
  Thai/Latin and Noto Sans SC for CJK (subset-embedded, ~55–75 KB), ำ drawn decomposed so extracted text is
  NFKC-equal, Thai + English footer (1155 only) with page numbers. Fonts + OFL licences in `lib/pdf/fonts/`.
- Mock: scripted interview (3 questions → read-back → "yes" ⇒ READY; confirm regex now whole-word, "Yesterday"
  no longer counts); extraction echoes only user lines. Fixes from qa review: nested `[REA[READY]DY]` (loop + hold
  from unclosed "["), scrub of Thai/full-width digits, dotted/bracketed/00-prefix phones, spaced passport numbers.
- Checked: typecheck, lint, test (35 files / 982); mock smoke of every route; PDF rasterized (Thai marks correct),
  text extracted with pdfjs; `next build` + `next start` in a copy: PDF 200 over HTTP, fonts in the route's trace.
  NOT checked: real-model output (no keys); pdfkit's own files in the Vercel trace (node_modules was a junction).

## 2026-11-20 — qa — P3-5 Report Assistant review + tests (done; P3-1, P3-2, P3-4 approved)
- New tests (all mock / sample mode): report-ready (every 2- and 3-way split of [READY] inputs, nested `[REA[READY]DY]`,
  early hold-back), api-report (chat + generate: first/last user, 60 msgs / 20k chars / 4000 per msg from types/protocol,
  `\n[READY]` only on confirm, ERROR_MARKER, PII never reaches any model prompt or the output, hotlines/amounts kept,
  exactly the two §3.3 headings, BADJSON retry / BADJSON2 500, generate may end with the assistant read-back (lead v0.4),
  nothing stored, 503), api-report-store (consent literal `true`, consent_outdated, re-scrub of client data, extra keys
  dropped, 503 in sample mode, 500 on DbError; GET/DELETE: missing header never calls lib/db; wrong token / unknown /
  malformed / expired → identical 404; DELETE 204 → GET 404), api-report-pdf (application/pdf, Bangkok-dated filename,
  Thai + English + Chinese text extracted with pdfjs-dist (NFKC), Markdown rendered, long Thai paragraph not clipped, no
  model/storage call), report-pipeline (normalizeReportMarkdown, parseFactsJson, scrubConversation, scrub formats),
  report-ui (report-state helpers, saveReplacing, full jsdom flow en + zh with unticked consent), evals-report.
  repo-safety: client value imports only from `@/types/protocol`, no pdfkit / `node:` in client code, report routes
  runtime=nodejs. CI client-bundle grep extended (delete_token_hash, timingSafeEqual, PDFDocument, Thai prompt).
- `pnpm eval -- --report` (evals/report.ts): 3 scripted interviews (en/zh) → generate → PDF; gates on the [READY] wire
  format, the two headings, PII and invented numbers. Mock 3/3; `--url <app>` runs it against a real-key app.
- Found and fixed by owners: nested [READY] re-forming mid-text (ai); extra model headings kept (ai); scrub missed spaced
  passports, Thai/full-width digits, dotted/parenthesised/00-prefixed phones (ai); a second save orphaned the first
  report's delete token (frontend: saveReplacing deletes the earlier one first).
- Checked: typecheck, lint, test (35 files / 982), build in a repo copy, client-bundle scan clean, `pnpm eval` and
  `pnpm eval -- --report` (mock) pass; `next start` smoke: /en|zh/report 200, chat ends `\n[READY]`, pdf 200, bad
  consent 400, GET without header 404.
  NOT checked: real-model interview/extraction quality (no keys), real Supabase `reports` table / pg_cron, 375 px visual
  pass by qa (frontend's headless run only), legal review of the Thai summary wording.

## 2026-11-20 — frontend — P3-4 Report UI (done, qa approved)
- `/[locale]/report`: privacy notice (AI provider, nothing stored unless you choose, no passport/ID numbers, does not file a
  report) → interview chat streaming `POST /api/report/chat` (client keeps and resends the conversation; localized greeting
  shown client-side only, so `messages[0]` is the user's; trailing `
[READY]` stripped, partial suffix held back while
  streaming; "Create summary" enabled only after READY) → `POST /api/report/generate` → preview split on the two §3.3
  headings (`lang="th"` / `lang="en"`) with a "NOT a police report" callout and the 1155 `HotlineLink` → Download PDF
  (`POST /api/report/pdf`, filename from Content-Disposition) → optional "Save for 30 days" with an UNTICKED consent box
  (Save disabled until ticked; `consent: true` + `CONSENT_VERSION`) → `{id, delete_token, expires_at}` only in localStorage
  (try/catch) → "Open saved summary" / "Delete now" (GET/DELETE with `x-delete-token`; 404 clears the record).
- Limits from `types/protocol.ts`: 4000/message, 60 messages, 20,000 chars, with 1 message + 2000 chars kept for the reply
  so `/generate` still fits. Retry only when the conversation ends with `user`; a message after a failed/stopped reply is
  merged into the last user message. Stop, retry, non-200, ERROR_MARKER, 400 (consent_required/outdated, invalid), 404,
  429, 503 (`save_unavailable` → "download the PDF instead") each have a localized message. Inline two-step confirms
  (no `window.confirm`) for Start over and Delete.
- Pure helpers for qa: `components/report/report-state.ts` (parseInterviewReply, checkNextMessage, isAtLimit,
  appendUserMessage, commitReply, canRetry, build{Chat,Generate,Save}Request, errorKeyFor, pdfFilename, splitSummary,
  load/store/clearSavedReport with injectable storage); fetch wrappers `report-api.ts`; `data-testid` hooks on every step.
  Messages: `report.*` (en + zh).
- Checked: typecheck/lint clean for my files; i18n, repo-safety, shell and page tests pass (the other failures are in qa's
  new P3-5 tests for lib/ai and `tests/helpers/pdf-text.ts`). `next build` + `next start` (AI_PROVIDER=mock,
  SAMPLE_REPORTS_IN_MEMORY=1, RATE_LIMIT_AI_PER_MIN=1000) in a separate copy; headless Chrome 375 px, en + zh: 68/68
  checks: notice → chat → READY → summary (Thai + English, tel:1155 only) → PDF (`%PDF-`, `sabaisafe-report-YYYYMMDD.pdf`)
  → consent + save → reload → reopen → delete (server 404 afterwards) → stale record 404, STREAMERROR + retry, 429, 503
  and consent_outdated on save (intercepted); scrollWidth 375 throughout, no raw message keys, no console errors.
  NOT checked: real AI provider / real Supabase save; very long conversations in the browser (unit-level only).
- qa review fix (PDPA): a second save used to overwrite the only id + token in localStorage, leaving the earlier report
  undeletable. `saveReplacing` (report-state.ts) now deletes the earlier report first (404 = fine; any other failure =
  nothing saved), and the save form warns "saving replaces your earlier summary". pdfFilename fallback uses the Bangkok date.
  Headless re-run 72/72 (adds: save A → save B → A 404, B 200).

## 2026-11-15 — frontend — P2-4 Legal Guide UI (done, qa approved)
- `/[locale]/legal`: ask box (1000-char limit, Enter submits, empty check) + 5 example questions by topic; streams
  `POST /api/chat` via `components/shared/text-stream.ts`; answer as Markdown; `[n]` links to source cards only for
  ids in the SOURCES trailer; fixed disclaimer always shown (the model's copy is stripped by exact match); sources list
  (title, law/law_th, section unless "TO VERIFY", area, excerpt, link if http(s)) with "Draft — not yet verified"
  badge for any non-VERIFIED source; emergency banner 1155/191/1669 (client keyword hint or `meta.is_emergency`);
  no-answer state lists the 4 hotlines from `lib/hotlines.ts`; loading skeleton, Stop, retry; non-200 / ERROR_MARKER /
  missing delimiter / bad trailer JSON each handled.
- Pure helpers for qa: `components/legal/parse.ts` (parseLegalStream, parseTrailer, linkCitations, stripDisclaimer,
  looksUrgent, showSection). Shared: `Markdown` renders `#src-N` citation links; `StatusBadge` kind `draft`.
  Messages: `legal.*`, `common.draft`, `errors.invalid` (en + zh).
- Checked: typecheck, lint, test (802 pass); `next build` + `next start` (AI_PROVIDER=mock) in a separate copy of the
  repo (so ai's `next dev` .next is not touched); headless Chrome 375 px en + zh: scrollWidth 375 in all states,
  answer + citations + draft badges, emergency banner (tel:1155/191/1669 only), no-answer (4 hotlines),
  STREAMERROR → error + retry, no raw message keys, no console errors except the site-wide `/favicon.ico` 404.

## 2026-11-15 — qa — P2-5 eval, Phase 2 review + tests
- Content review (P2-1, 32 DRAFT files): frontmatter per §5, all DRAFT, `section: "TO VERIFY"`, no invented section numbers,
  fines or phone numbers, en/zh parity OK. Added `tests/content-legal-parity.test.ts` (## count, shared source_url/location/
  updated/verify_priority, TO VERIFY markers kept in zh, quoted values, no unknown keys). For the legal team: every
  `source_url` is empty (no source links in the UI yet); check the vaping import basis (Customs Act B.E. 2560 vs the Commerce
  notification under the Export and Import of Goods Act B.E. 2522) and the 2022 cannabis wording.
- P2-5: `evals/questions.jsonl` (40 = 20 en + 20 zh; all 16 slugs per language; 2 emergency, 4 out-of-scope), `evals/score.ts`
  (pure scoring), `evals/run.ts` (`pnpm eval`: in-process, mock without keys; `-- --url <app>` with 429 retry; `--shape-only`).
  Mock run: all gates pass (disclaimer, citations, language, emergency, complete 100%, 0 invented numbers, OOS 4/4 refused);
  lexical mock hit-rate 64% is not a quality score. Same numbers over HTTP against `next start`.
- New tests: api-chat (28), ingest (12, in-memory store), legal-content (29), legal-pipeline (20, answer-guard + selectSources +
  sample index), legal-parse (19), legal-guide-ui (8, jsdom), evals (17). Found and ai fixed: answer-guard turned a hotline
  split across chunks into "[REDACTED]5"; mock cited a missing [2]; ingest stored mock vectors in a real DB; embed key checked late.
- Checked: typecheck, lint, test (28 files / 803 tests), build, `pnpm ingest --dry-run` (32 docs / 128 chunks), SSR /en|zh/legal 200.
  NOT checked: real-key eval (no keys), real Supabase ingest, 375 px visual pass by qa.

## 2026-11-15 — ai — P2-2 ingest, P2-3 RAG + POST /api/chat
- `lib/ai/legal-content.ts`: zod frontmatter (§5), split on `## `, sub-split >500 units (CJK char = 0.5), content_hash over
  content + status/section/law/law_th/source_url/location/topic, chunk = "title\nheading\n\ntext". Shared by ingest and sample search.
- `lib/ai/ingest.ts` + `scripts/ingest.ts` (`pnpm ingest [--dry-run] [--force] [--dir] [--json]`): skips unchanged hashes, embeds in
  batches of 64, upsert, deleteStaleChunks per doc, deleteMissingDocs; refuses an empty content dir. Dry run: no DB, mock vectors, no keys.
- `lib/ai/legal.ts` + `app/api/chat/route.ts`: scrubPII → rewrite (fast model, zod-parsed, falls back to the question) → embed →
  match_legal (zh: zh + all languages, zh preferred, en duplicate of a zh doc dropped) → LEGAL_MIN_SIMILARITY → max 6 sources →
  stream + SOURCES trailer; nothing passes ⇒ NO_ANSWER_MESSAGE, no answer-model call. 400/503/ERROR_MARKER as §3.
- `lib/ai/legal-index.ts`: sample mode (no Supabase) searches content/legal in memory (same chunks, cosine), so the demo works.
- `lib/ai/answer-guard.ts`: redacts invented phone numbers / non-hotline short codes in the streamed answer; appends the disclaimer if missing.
- `mockEmbedding` now drops stopwords, stems plurals, adds CJK bigrams (off-topic questions fall under 0.30).
- Checked: typecheck, lint (0 errors), test 774/774; `pnpm ingest --dry-run` = 32 docs / 128 chunks; ingest against a fake store
  (re-run embeds 0, stale + removed docs deleted); route smoke in mock+sample mode (en, zh, emergency, no-answer, STREAMERROR, 400, 503).
  NOT checked: real Supabase / OpenAI / Anthropic (no keys); threshold 0.30 untuned for real embeddings (needs `pnpm eval`).
- qa review fixes: guard never splits a number across chunks (split "1155" bug) and flushes on error; mock cites only given
  source ids; OpenAI key checked up front (`requireEmbeddingKey`); ingest refuses AI_PROVIDER=mock on a real DB unless
  `--allow-mock`. qa PASS (suite 802/802); P2-2 and P2-3 done.

## 2026-11-15 — frontend — P1-4 app shell, P1-6 Help, P1-7 Fair Price
- Shell: sticky header (logo, en/zh switch keeping the path), SOS strip 1155/191/1669 from `lib/hotlines.ts` on every page, 5-tab bottom nav, home tiles; shadcn tokens in `app/globals.css`; Legal/Report placeholders.
- Help: Server Component calls `getHelp({})` in try/catch; 4 hotlines always render (DB down → "unavailable" note); DB rows with hotline numbers deduped; category chips; businesses by server order with Sponsored / Sample / criteria labels.
- Fair Price: Server Component calls `findPrices({})` in try/catch; item (by `item_key`, grouped by category) + area pickers, island-wide rows always included; cards show range, translated unit, fixed-by-law flag, notes/notes_zh, source + date, Sample badge. "I was quoted X" streams `/api/chat/price` with `{item, quoted, area, unit, lang}` (lazy-loaded; handles ERROR_MARKER, non-200, abort); verdict badge + "compared with" rows from `types/price-verdict.ts` with the same args; unit picker when units mix; `parseQuoted` accepts commas, full-width digits, ฿/THB/baht/บาท/铢.
- Pure helpers for tests: `components/shared/format.ts`, `components/shared/text-stream.ts`, `components/help/merge-contacts.ts`, `components/price/picker.ts`, `components/shell/nav-items.ts`.
- Checked: typecheck, lint, test (512 pass), `next build`; headless Chrome at 375 px (mobile emulation) en+zh for /, /help, /price: scrollWidth 375, no console errors; filters, locale switch and price check (mock provider) work.

## 2026-11-15 — qa — P1-9 tests (Phase 1)
- 18 test files, 539 tests (incl. content/legal invariants, shared verdict rule + badge/AI parity, units, email scrub,
  frontend text-stream/nav/badges), all mock / sample mode (no network, no Supabase): middleware (compiled matcher, admin
  auth + lockout, rate limit, IP spoofing), rate-limit, hotlines, i18n key/placeholder parity, repo safety (client
  imports, env reads, secret names, runtime=nodejs, no literal hotline tel: links), content invariants
  (prices.csv, help.json), lib/db sample loader + query rules + reports store (scrub, token, expiry, prune),
  /api/price, /api/help, /api/chat/price (verdicts, units, 400/503/500, ERROR_MARKER), stream.ts, provider mock,
  scrub.ts, frontend helpers, Help/Price pages falling back when lib/db throws (en + zh).
- Shared helpers: `tests/helpers/phones.ts` (invented-number detector, reused by evals), `tests/helpers/csv.ts`;
  fixtures in `tests/fixtures/content` (via SAMPLE_DATA_DIR).
- CI: added a client-bundle secret scan after `pnpm build`, and a separate `db-smoke` job (supabase/postgres
  15.19.0.004 service) that applies migrations + seed (twice) and runs `tests/sql/smoke.sql` (match_legal lang
  filter / cap 20 / ordering, RLS for anon + authenticated, report time trigger, pg_cron job, seed invariants).
  NOT run yet: no Docker daemon locally; first real run will be on GitHub Actions.
- Removed tests/skeleton.test.ts (user approved; covered by hotlines/rate-limit tests).
- Checked: pnpm typecheck, lint, test (539/539), build all pass; bundle scan clean. SSR fetch of /en|zh/{,help,price}
  returns 200 with correct lang, viewport and hotline tel: links. No visual 375px check by qa.

## 2026-11-15 — content — P2-1 legal topics (DRAFT)
- 16 topics x en/zh in `content/legal/{en,zh}/` (32 files), all `status: "DRAFT"`, `section: "TO VERIFY"`, `source_url: ""`.
  `drugs-and-cannabis` and `vaping-e-cigarettes` carry `verify_priority: "high"`.
- No fines, rates or phone numbers other than 1155/191/1669/1166; every unsourced amount is "TO VERIFY".
- Checked with gray-matter script: same slugs in en/zh, lang = folder, topic enum, one `#`, 4 `##` sections,
  no ###/tables/HTML, no phone-like strings. Awaiting qa review and legal-team verification.

## 2026-11-15 — backend — P1-1, P1-2, P1-3 (+ P3-3 reports.ts) DB, lib/db, /api/price, /api/help, seed
- `supabase/migrations/` (5 files): extensions (vector, pgcrypto, pg_cron, fails if pg_cron is missing), 5 tables with
  CHECKs mirroring lib/db/schema.ts (units, categories, phone format + phone rules, min<=max), HNSW + lang index,
  updated_at triggers; RLS (anon read-only on 4 tables, none on reports; trigger forces consent_at/expires_at);
  `match_legal` (SQL, `match_legal.lang` qualified, cap 20); pg_cron `delete-expired-reports` 03:00 UTC. `supabase/config.toml`.
- `types/db.ts`; `lib/db/`: client (plain supabase-js, no cookies), errors, csv (RFC 4180, no dep), schema (zod), sample
  (`parsePricesCsv`, `parseHelpJson`, `loadSampleData`, hotlines from lib/hotlines.ts, `SAMPLE_DATA_DIR`), query (shared
  filter/sort for both modes), prices, help, legal (match + ingest helpers), reports (token sha256, constant-time,
  scrubDeep re-scrub, prune on insert, in-memory when SAMPLE_REPORTS_IN_MEMORY=1), http (error shape), seed-sql.
- `GET /api/price`, `GET /api/help` (400 on bad params, Cache-Control s-maxage=300). `pnpm db:seed` → `supabase/seed.sql`
  (32 prices, 4 hotlines + 13 contacts, 6 businesses from content/).
- Stricter than v0.2 text, per qa tests: contact phone needs verified=true too; is_fixed_by_law=true needs source_url.
- Checked: typecheck, lint, test (288 passed) green; sample-mode smoke script over real content/; SQL NOT run (no
  Supabase/Docker yet), needs a manual `supabase db push` + seed on the real project.

## 2026-11-15 — ai — P1-8 provider, mock mode, scrub, stream, /api/chat/price
- `lib/ai/scrub.ts` (no imports): scrubPassport / scrubPhone (TH, CN, +intl) / scrubPII / scrubDeep. Keeps words, hotlines, amounts.
- `lib/ai/provider.ts`: AI_PROVIDER anthropic|openai|mock (unset => anthropic). Defaults claude-sonnet-5-5 / claude-haiku-5-5
  (openai: gpt-4.1 / gpt-4.1-mini), AI_MODEL_* overrides, OpenAI text-embedding-3-small; missing key => 503.
  Mock = MockLanguageModelV4 dispatching on the system prompt (`lib/ai/mock-model.ts`); spec in the provider.ts header.
- `lib/ai/stream.ts`: text/plain stream, strips \u001e, SOURCES trailer, [READY] normalized to the exact "\n[READY]" suffix
  (partial tokens held back), ERROR_MARKER on mid-stream failure. `lib/ai/http.ts`: JSON errors per contracts §3.
- `lib/ai/constants.ts` (DISCLAIMER, NO_ANSWER_MESSAGE, computeVerdict, LEGAL_MIN_SIMILARITY), `lib/ai/mock-fixtures.ts`.
- prompts.ts (lead-approved): fairPriceUser passes is_fixed_by_law ("LEGALLY FIXED PRICE"); the "400–600 THB" example is
  now a format-only placeholder; fixed DISCLAIMER en/zh strings are embedded verbatim in legalGuideSystem.
- `POST /api/chat/price`: findPrices → fairPriceSystem/fairPriceUser → stream.
- Checked: typecheck + lint clean; qa's tests/scrub.test.ts passes; 29 handoff tests (stream, mock, verdict, price route
  incl. 400/503/ERROR_MARKER) pass and were handed to qa. No real API calls. Awaiting qa review.
- Follow-ups from qa review: scrub.ts redacts emails (lead-approved); /api/chat/price no longer mixes units
  (`selectRefs`: area-specific rows first, then one unit). Full suite 350/350.
- Verdict rule moved to `types/price-verdict.ts` (single copy for UI + ai: selectRefs, computeVerdict, verdictFor).
  `unit` request field honoured (§3.7); with no unit, first unit in PRICE_UNITS order. The code verdict is passed to the model
  as "COMPUTED VERDICT" in fairPriceUser. Suite 377/377.
- prompts.ts (lead-approved): 5th verdict "No price quoted" (zh 未提供报价) in fairPriceSystem, for quoted=null with refs;
  "Not enough data" = no refs. legalGuideUser drops "section TO VERIFY". 2 qa tests need updating for the new rule.
- Prompt input (lead-approved): fairPriceUser gets readable units in the reply language (UNIT_LABEL in lib/ai/price.ts,
  e.g. per_day → "per day" / "每天"), so PriceUnit keys never reach the model. qa approved P1-8; suite 512/512.

## 2026-11-15 — content — P1-5 sample prices and help data
- `content/prices.csv`: 32 SAMPLE DATA rows (27 items, 10 areas list, PRICE_UNITS keys, 15-column v0.2 header).
- `content/help.json`: 13 real Phuket contacts (phone/address null, verified false, is_sample true; no hotlines)
  and 6 fictional `[SAMPLE]` businesses (1 sponsored, phone null).
- Checked with a script against contracts §5 rules (header, enums, min<=max, no phone-like strings, no hotlines). Awaiting qa review.

## 2026-11-15 — lead — Phase 0 contracts v0.2
- docs/contracts.md v0.2 agreed by backend, ai, frontend, content, qa (see its changelog).
- QA fixes: middleware matcher (admin page had no auth: lost backslash from a shell heredoc), admin brute-force
  throttle checked before the password compare, Basic-auth parsing, env limit parsing, x-real-ip.
- ESLint: no-useless-escape=error; components/** can't import lib/db or lib/ai.
- Installed react-markdown, remark-gfm, pdfkit, @types/pdfkit, pdfjs-dist, shadcn components; db:seed script.
- Checked: pnpm typecheck, lint, test, build all pass.

## 2026-11-15 — lead — Phase 0 skeleton
- Repo skeleton: Next.js 15 + TS strict + Tailwind 4 + next-intl (en/zh) + Vitest + ESLint, CI workflow.
- `middleware.ts`: locale routing, per-IP rate limit on `/api/*`, Basic auth for admin.
- `lib/hotlines.ts`, `lib/rate-limit.ts`, `types/api.ts`, `docs/contracts.md` v0.1, `.env.example`.
