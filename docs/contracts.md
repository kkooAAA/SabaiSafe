# SabaiSafe — Contracts (v0.2, Phase 0)

Status: **AGREED** by backend, ai, frontend, content and qa (2026-11-15). Changes are recorded in §9 (changelog).
Shared TypeScript shapes live in `types/api.ts` (API) and `types/db.ts` (DB rows, owned by backend).
If this doc and `types/api.ts` disagree, raise it with the lead; don't silently pick one.

---

## 1. Environment and modes

| Var | Used by | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | lib/db | Empty URL ⇒ **sample mode**: lib/db serves in-memory data loaded from `content/prices.csv` and `content/help.json`; `matchLegal` returns nothing, and ai's `/api/chat` searches `content/legal` in memory instead (`lib/ai/legal-index.ts`). |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | ingest, report storage, admin writes. Never imported from client code. |
| `AI_PROVIDER` | lib/ai | `anthropic` \| `openai` \| `mock`. `mock` returns deterministic canned output and a fake embedding; tests and CI always use it. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | lib/ai | OpenAI key is needed for embeddings in any non-mock mode. |
| `AI_MODEL_CHAT`, `AI_MODEL_FAST` | lib/ai | Optional overrides. FAST = query rewrite, router, extraction. |
| `ADMIN_PASSWORD` | middleware | HTTP Basic, user `admin`, guards `/{locale}/admin` and `/api/admin/*`. Unset ⇒ admin returns 503. |
| `RATE_LIMIT_AI_PER_MIN` (15), `RATE_LIMIT_DATA_PER_MIN` (60) | middleware | Per IP. AI routes = `/api/chat*`, `/api/report*`. Invalid/blank ⇒ default. |
| `LEGAL_MIN_SIMILARITY` (0.30) | lib/ai | Minimum cosine similarity for a chunk to be used as a source. |
| `LEGAL_CONTENT_DIR` | lib/ai | Optional. Overrides the `content/legal` root for ingest and the in-memory legal search (tests). |
| `SAMPLE_REPORTS_IN_MEMORY` | lib/db | `1` ⇒ saved reports go to an in-memory store (tests). Otherwise sample mode makes save return 503. |

Rate limiting and admin auth are already done in `middleware.ts` (lead). Route handlers don't repeat them.
**Honest scope:** middleware runs on the Edge runtime, so the counters live in each isolate/region. The limit is a
soft per-isolate brake, not a global guarantee. A global limit needs a shared store (e.g. Upstash), which is a
paid-service decision for the project owner. Admin: 10 failed logins per IP per minute ⇒ 429, checked before the
password compare.

## 2. Database (Supabase Postgres, owner: backend)

All tables: `created_at timestamptz default now()`, `updated_at timestamptz default now()` (trigger),
RLS **enabled**. The anon role may only `select` from `prices`, `businesses` (where `is_active`),
`help_contacts`, `legal_chunks`. `reports` has **no** anon/authenticated policies; only the service role touches it.

### 2.1 `legal_chunks`
| column | type | notes |
|---|---|---|
| id | bigint identity PK | `chunk_id` in API |
| doc_slug | text not null | file name without `.md`; same slug for the en and zh versions of a topic |
| chunk_index | int not null | 0-based within (doc_slug, lang) |
| lang | text not null check in ('en','zh') | |
| title, law | text not null | from frontmatter |
| law_th, section, location, source_url | text null | `section` may be literally `TO VERIFY` |
| topic | text not null | same enum as the query rewriter `topic` |
| status | text not null check in ('DRAFT','VERIFIED') | |
| heading | text null | the H2 the chunk came from |
| content | text not null | chunk text, prefixed by title + heading for better embeddings |
| content_hash | text not null | sha256 of content **plus** the frontmatter fields status, section, law, law_th, source_url, location, topic (so DRAFT→VERIFIED is picked up); ingest skips re-embedding when unchanged |
| embedding | vector(1536) not null | OpenAI `text-embedding-3-small` |

`unique (doc_slug, lang, chunk_index)`; HNSW index on `embedding vector_cosine_ops`; btree on `lang`.

### 2.2 RPC `match_legal(query_embedding vector(1536), match_count int, lang text)`
Returns `table (id bigint, doc_slug text, chunk_index int, lang text, title text, law text, law_th text,
section text, location text, source_url text, topic text, status text, heading text, content text, similarity float)`.
- Filters `legal_chunks.lang = match_legal.lang`; if `lang` is null, no language filter. **The parameter must be
  qualified as `match_legal.lang`**: an unqualified `lang` resolves to the column and silently disables the filter.
- `similarity = 1 - (embedding <=> query_embedding)`, ordered by distance, limit `match_count` (cap 20).
- `security invoker`, `stable`; granted to anon and service_role.
- No similarity threshold inside SQL; ai applies the threshold (start at 0.30, tune with evals).

### 2.3 `prices`
| column | type |
|---|---|
| id | uuid PK default gen_random_uuid() |
| item_key | text not null — slug, e.g. `taxi_airport_patong` |
| item_name_en, item_name_zh | text not null |
| category | text check in ('transport','rental','activity','food','accommodation','other') |
| area | text not null — e.g. `Patong`, `Phuket Airport`, `Phuket` (island-wide) |
| min_thb, max_thb | numeric(10,2) not null, check min ≤ max |
| unit | text not null, check in `PRICE_UNITS` (`types/api.ts`): per_trip, per_km, per_person, per_30min, per_hour, per_day, per_week, per_night, per_item, per_kg. The UI translates keys via `messages` |
| is_fixed_by_law | boolean default false — true only when a source says the price is legally set (e.g. meter rates); true ⇒ `source_url` non-null (loader + SQL check) |
| source | text not null — human-readable, e.g. `Phuket Provincial Land Transport Office` or `SAMPLE DATA` |
| source_url | text null |
| collected_at | date not null |
| notes, notes_zh | text null — the UI falls back to `notes` when `notes_zh` is null |
| is_sample | boolean not null default true |

`unique (item_key, area, source, collected_at)`.

### 2.4 `businesses`
Columns exactly as `Business` in `types/api.ts` plus timestamps. `criteria_met text[]` uses keys from
`BUSINESS_CRITERIA`. `is_sponsored boolean not null default false`. **Sponsorship never changes ordering**:
lists are ordered by `name`. The UI must show a visible "Sponsored" label on sponsored rows.
**Phone rule:** `phone` non-null ⇒ `source_url` non-null AND `verified_at` non-null. The loader/seed rejects other rows.

### 2.5 `help_contacts`
Columns exactly as `HelpContact` in `types/api.ts` plus timestamps. Ordered by `category, sort_order, name_en`.
The four hotlines are **not** in `content/help.json`. backend generates them from `lib/hotlines.ts` (single source of
truth) for both sample mode and `seed.sql`: 1155/191/1669 `category='emergency'`, 1166 `category='consumer'`,
`verified=true`, `is_sample=false`, `sort_order` 1–4.
**Phone rule:** `phone` non-null ⇒ `source_url` (official page) non-null **and** `verified = true`. Otherwise `phone = null`.
Enforced in both the loader and a SQL check constraint.
Phones are a short code or `+66 …` format; the UI builds `tel:` links by removing spaces. Real contacts other than
the hotlines are `is_sample = true` until a human verifies them. The Help page catches DB errors itself and still
shows the four hotlines from `lib/hotlines.ts`.

### 2.6 `reports`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| lang | text check in ('en','zh') | UI language at the time |
| incident_type | text | from facts |
| facts | jsonb not null | `ReportFacts`, after passport scrubbing |
| markdown | text not null | Thai + English summary |
| consent_at | timestamptz not null | set server-side at insert |
| consent_version | text not null | `CONSENT_VERSION` in types/api.ts |
| delete_token_hash | text not null | sha256 of the random delete token returned once by save |
| expires_at | timestamptz not null default now() + interval '30 days' | |

Deletion: `pg_cron` job daily at 03:00 UTC `delete from reports where expires_at < now()`. As a belt-and-braces
fallback, `lib/db` deletes expired rows on each insert. No IP address, user agent, phone or passport number is stored:
`facts` and `markdown` are scrubbed by `lib/ai/scrub.ts#scrubDeep` in `/api/report/save` **and again** in
`saveReport` (the client sends them back, so the server never trusts them).

### 2.7 Seed data
`supabase/seed.sql` is generated by backend from content's files (`content/prices.csv`, `content/help.json`) with a
small script under `supabase/scripts/`. Every generated row is `is_sample = true` except the four hotlines.
Sample businesses are fictional and their names start with `[SAMPLE]`.

## 3. API routes

All request bodies are JSON and are validated with the zod schemas in `types/api.ts`. Errors are always
`{ "error": { "code": string, "message": string } }`. Codes: 400 `bad_request` / `consent_required` /
`consent_outdated`, 401 `unauthorized` (middleware), 404 `not_found`, 429 `rate_limited` (middleware), 500 `internal`,
503 `unavailable` (missing key or DB). Every route sets `export const runtime = "nodejs"`.

**Streamed routes** (`/api/chat`, `/api/report/chat`, `/api/chat/price`) are `text/plain; charset=utf-8`. If the model
fails after streaming starts, the server appends `ERROR_MARKER` (`types/api.ts`) and closes; nothing follows it.
The server strips `\u001e` from model text. Clients render only the text before the first `\n\u001e`.

### 3.1 `POST /api/chat` — Legal Guide (owner: ai)
Request `ChatRequest`: `{ "question": string(1..1000), "lang": "en" | "zh" }`

Pipeline: query rewrite (FAST, `QUERY_REWRITE_SYSTEM`) → embed `search_query` → `match_legal(emb, 6, lang)` →
drop rows under the threshold → `legalGuideSystem(lang)` + `legalGuideUser(question, sources)` → stream.
If no source passes the threshold, ai **does not call the answer model**; it streams a fixed localized
"no verified information, call 1155" message and sets `no_answer: true`.

Response: `200`, `Content-Type: text/plain; charset=utf-8`, chunked. Body =
```
<answer text, streamed, Markdown, with inline citations [1] [2]>
\n\u001eSOURCES\u001e\n
<one line of JSON: ChatTrailer>
```
`SOURCES_DELIMITER` is exported from `types/api.ts`. The client splits on the first occurrence; a stream that ends
without it is incomplete; a trailer with invalid JSON shows the answer and disclaimer without sources; `[n]` is a link
only if `n` is an id in the trailer. For zh questions ai searches zh and all-language chunks, merges, and prefers zh.
A chunk whose section is `TO VERIFY` is still a source, but the section is not shown to the model as a number. `ChatTrailer`:
```json
{ "sources": [LegalSource...], "meta": { "is_emergency": false, "no_answer": false, "topic": "rental", "location": null } }
```
`LegalSource.id` is the citation number; only sources actually given to the model are listed. The UI shows a
"Draft" badge on any source with `status: "DRAFT"` and always shows the disclaimer, even if the model omitted it.
If `is_emergency` is true the UI shows the emergency banner (1155 / 191 / 1669) above the answer.

### 3.2 `POST /api/report/chat` — interview (owner: ai)
Request `ReportChatRequest`: `{ "messages": ChatMessage[] (1..60), "lang": "en" | "zh" }`. The client keeps the
whole conversation and resends it. `messages[0]` and the last message must be `user`, else 400; the client shows a
localized greeting itself. Max 20,000 characters in total (`Conversation` in types/api.ts).
Response: streamed `text/plain`, the assistant's next message. When the user has confirmed the read-back, the server
guarantees `[READY]` appears only as the final bytes `\n[READY]` (it holds back partial tokens). The client strips it
from the display and enables "Create summary".

### 3.3 `POST /api/report/generate` (owner: ai)
Request: `{ "messages": ChatMessage[] }`. Runs `REPORT_EXTRACT_SYSTEM` (temperature 0, validated against `ReportFacts`,
one retry on invalid JSON), scrubs with `lib/ai/scrub.ts#scrubDeep`, then `REPORT_THAI_SYSTEM`. The scrubber (pure,
no imports) redacts **number-shaped tokens only**: `/\b[A-Z]{1,2}\d{6,9}\b/i`, a 9-digit number near
passport/护照/หนังสือเดินทาง, the token right after those words, phone numbers (Thai mobile/landline, Chinese
mobiles with or without +86, long `+<country>` numbers), and email addresses. It keeps the four hotlines, money amounts, and the fact itself ("they kept my passport").
The Markdown uses exactly the two headings `## ฉบับภาษาไทย (สำหรับเจ้าหน้าที่)` and `## English translation (for you to check)`,
normalized to valid GFM. Response `200 application/json` `ReportGenerateResponse`:
`{ "facts": ReportFacts, "markdown": string }`. Nothing is stored.

### 3.4 `POST /api/report/pdf` (owner: ai)
Request `ReportPdfRequest`: `{ "markdown": string, "facts"?: ReportFacts }`. Response `200 application/pdf`,
`Content-Disposition: attachment; filename="sabaisafe-report-YYYYMMDD.pdf"`. Library: **pdfkit** (its fontkit shapes
Thai marks correctly; listed in `serverExternalPackages`). Lines are wrapped with `Intl.Segmenter("th")`. Fonts
(OFL) in `lib/pdf/fonts/`: Sarabun Regular/Bold for Thai and Latin, Noto Sans SC for Chinese, plus `OFL.txt`.
Stateless; nothing is stored.

### 3.5 `POST /api/report/save` (owner: ai, uses backend's `lib/db/reports.ts`)
Request `ReportSaveRequest`: `{ facts, markdown, lang, consent: true, consent_version }`. `consent` must be literally
`true`, else 400 `consent_required`; `consent_version` must equal `CONSENT_VERSION`, else 400 `consent_outdated`.
Re-scrubs, then `saveReport`. Response `201` `{ "id": uuid, "expires_at": ISO string, "delete_token": string }`.
`delete_token` is 32 random bytes (base64url), returned once; only its sha256 is stored.
Saving is optional for the user; generate and PDF work without it. Purpose: the user can re-open the summary from
the same device within 30 days (the UI keeps id + token in localStorage) and delete it early.

### 3.5a `GET /api/report/:id` and `DELETE /api/report/:id` (owner: ai, uses backend's `getReport`/`deleteReport`)
Header `x-delete-token: <token>` on both. GET → `200` `{ facts, markdown, expires_at }`; DELETE → `204`.
Wrong id, wrong token, expired or missing header ⇒ `404 not_found` (never says which; a missing header doesn't touch the DB).
Boundary: backend's `saveReport` generates the token (32 bytes, base64url), stores only its sha256, scrubs again,
and returns `{id, expires_at, delete_token}`, which the route passes through unchanged with 201. `getReport(id, token)`
returns its result or `null`; `deleteReport(id, token)` returns `true`/`false`. Both compare the sha256 in constant time
inside lib/db and treat expired rows as missing. `DbUnavailableError` ⇒ 503, `DbError` ⇒ 500.

### 3.6 `GET /api/price?item=&area=` (owner: backend)
Both params optional. `item` matches `item_key`, `item_name_en` or `item_name_zh` as a substring after normalizing
both sides (lowercase; spaces, hyphens and underscores removed), so `jetski`, `jet-ski` and `Jet Ski` all match. A
blank `item` returns everything; an `item` made only of separators (e.g. `---`) returns nothing; `area` matches `area` case-insensitively (substring), and rows with `area = 'Phuket'` (island-wide)
are always included when an area is given. No params ⇒ all rows (for the picker). Max 100 rows, ordered by
`category, item_name_en, area`. Response `PriceResponse`: `{ "results": PriceRef[] }`.

### 3.7 `POST /api/chat/price` — Fair Price explanation (owner: ai)
Request `PriceExplainRequest`: `{ "item": string, "quoted": number | null, "area"?: string | null, "unit"?: PriceUnit | null, "lang" }`.
The client sends `item` = the picker's `item_key` and `unit` = the unit of the row the user is looking at. ai compares
only against rows of that unit, using the area's own rows when an area is given. With no `unit` and mixed units, ai
picks the first unit in `PRICE_UNITS` order (deterministic). The verdict rule lives in `types/price-verdict.ts`, the
single copy shared by ai and frontend. ai calls backend's `lib/db/prices.ts#findPrices({item, area})`
directly (no HTTP hop), then `fairPriceSystem` + `fairPriceUser` (which passes `is_fixed_by_law`). The verdict band is
computed in code and given to the model. Response: streamed `text/plain`, no trailer; the UI shows source and date
from `GET /api/price`. No refs ⇒ "Not enough data".

### 3.8 `GET /api/help?category=` (owner: backend)
`category` optional; matches `HelpContact.category` or `Business.category`. Response `HelpResponse`:
`{ "contacts": HelpContact[], "businesses": Business[] }`. Inactive businesses are never returned.

### 3.9 Admin (owner: backend, Phase 4)
`GET/POST /api/admin/prices`, `PATCH/DELETE /api/admin/prices/:id`, and the same for `/api/admin/businesses`.
Bodies are the row types without `id`/timestamps. Uses the service-role client. Auth is in middleware.
(`DELETE` is a soft delete for businesses: `is_active = false`.)

## 4. Server-side module boundaries

| Module | Owner | Exports (minimum) |
|---|---|---|
| `lib/db/client.ts` | backend | `createAnonClient()`, `createServiceClient()` (plain supabase-js, no cookies, so ingest runs under tsx), `isSampleMode()` |
| `lib/db/errors.ts` | backend | `DbUnavailableError` (→503), `DbError` (→500), `SampleDataError` |
| `lib/db/sample.ts` | backend | `parsePricesCsv(text)`, `loadSampleData(csv, helpJson)`: zod-validated (header, enums incl. `PRICE_UNITS`, min ≤ max, areas, phone rules), adds hotlines from `lib/hotlines.ts` |
| `lib/db/prices.ts` | backend | `findPrices({item?, area?}): Promise<PriceRef[]>` |
| `lib/db/help.ts` | backend | `getHelp({category?}): Promise<HelpResponse>` |
| `lib/db/legal.ts` | backend | `matchLegal(embedding, count, lang: UiLang \| null)` → rows of §2.2 (`[]` in sample mode); `upsertLegalChunks(rows)`, `deleteStaleChunks(doc_slug, lang, keepCount)`, `deleteMissingDocs(present): Promise<number>`, `getChunkHashes()` keyed `` `${doc_slug}\|${lang}\|${chunk_index}` `` |
| `lib/db/reports.ts` | backend | `saveReport(...)`, `getReport(id, token)`, `deleteReport(id, token)`; deletes expired rows on insert; in-memory when `SAMPLE_REPORTS_IN_MEMORY=1` |
| `lib/ai/provider.ts` | ai | `chatModel()`, `fastModel()`, `embed(text)`, `embedMany(texts)`; honors `AI_PROVIDER=mock`. Defaults: anthropic `claude-sonnet-5-5` / `claude-haiku-5-5` |
| `lib/ai/scrub.ts` | ai | `scrubPassport`, `scrubPhone`, `scrubPII`, `scrubDeep` (pure, no imports) |
| `lib/ai/stream.ts`, `lib/ai/constants.ts`, `lib/ai/mock-fixtures.ts` | ai | trailer/ERROR_MARKER/[READY] handling; `DISCLAIMER`, `NO_ANSWER_MESSAGE` (en, zh); mock sources |
| `lib/ai/legal.ts`, `lib/ai/report.ts`, `lib/ai/price.ts` | ai | pipelines used by the routes |
| `lib/hotlines.ts` | lead | the four hotline numbers |

Client components (`components/**`) never import `lib/db/*` or `lib/ai/*`; ESLint enforces this. Server Components in
`app/[locale]/**` may call the read helpers `findPrices` and `getHelp` directly and must catch `DbError`.
`server-only` is not used (it would break ingest and Vitest).

## 5. Content format (owner: content; consumed by ai's ingest)

- Path: `content/legal/{en|zh}/{slug}.md`. The en and zh versions of a topic share the slug.
- Frontmatter: the fields in CLAUDE.md (`title, law, law_th, section, location, lang, source_url, status`) **plus**
  `topic` (rewriter enum, required), `updated` (`"YYYY-MM-DD"`), and optional `verify_priority: "high"` (ingest
  ignores it; used for fast-changing law such as cannabis and vaping). `lang` must match the folder. Every value is
  double-quoted (gray-matter turns unquoted dates into Date objects). Several laws are joined with `"; "`.
  `source_url: ""` means null. Gambling and drones use topic `other`; vaping uses `alcohol_drugs`.
- Body: one `#` title, then `##` sections only (no `###`, no tables). Ingest splits on lines starting `## ` and
  sub-splits sections over ~500 words. Aim for 150–400 words per section. Headings are descriptive; suggested:
  en `Summary / What the law says / In practice in Phuket / What you can do`,
  zh `摘要 / 法律规定 / 普吉岛实际情况 / 您可以怎么做`.
- `status: DRAFT` always (AI-written). `section: "TO VERIFY"` whenever unsure. Never invent numbers, fines, or phone
  numbers other than the four hotlines. Fines/amounts that aren't sourced are written as "TO VERIFY".
- `content/prices.csv` header (exact, 15 columns): `item_key,item_name_en,item_name_zh,category,area,min_thb,max_thb,unit,is_fixed_by_law,source,source_url,collected_at,notes,notes_zh,is_sample`
  UTF-8 without BOM; quoted only when needed; lowercase `true`/`false`; dates `YYYY-MM-DD`; plain numbers (no ฿ or
  thousands separators); only `source_url`, `notes`, `notes_zh` may be empty (= null). `unit` is a `PRICE_UNITS` key.
  Areas: Phuket (island-wide), Phuket Airport, Phuket Town, Patong, Kata, Karon, Kamala, Rawai, Chalong, Bang Tao.
  Sample rows use `source = "SAMPLE DATA"`, `is_sample = true`, `is_fixed_by_law = false`.
- `content/help.json`: `{ "contacts": Omit<HelpContact,"id">[], "businesses": Omit<Business,"id">[] }`, every field
  written out with explicit `null`. Contains **none** of the four hotlines (qa tests this).

## 6. Frontend routes (owner: frontend)

`/{en|zh}` home (4 feature tiles + emergency strip) · `/legal` · `/report` · `/price` · `/help` · `/admin` (Phase 4).
Mobile-first, 375 px wide minimum, every string in `messages/{en,zh}.json`. A persistent emergency strip
(1155 / 191 / 1669 as `tel:` links) appears on every page, using `lib/hotlines.ts`.
Report flow: privacy notice (data goes to the AI provider, nothing stored unless you choose) → chat → "Create summary"
→ preview (Thai + English) → Download PDF → optional "Save for 30 days" with an unticked consent checkbox.

## 7. Testing (owner: qa)

`pnpm test` runs Vitest on `tests/**` with `AI_PROVIDER=mock` and no Supabase env (sample mode). Route handlers are
tested by importing them and calling `POST(new Request(...))`. `pnpm eval` runs `evals/run.ts` against a running
app with real keys; 40 questions in `evals/questions.jsonl` with `expected_slugs`; it reports retrieval hit-rate,
citation presence, disclaimer presence, and no invented phone numbers.

Mock triggers (ai, agreed with qa): emergency keywords ⇒ `is_emergency`; `NOANSWER` ⇒ no-answer path; `BADJSON` ⇒
first extraction fails, retry succeeds; `BADJSON2` ⇒ both fail (500); `STREAMERROR` ⇒ stream ends with `ERROR_MARKER`;
last user message `yes`/`是` ⇒ reply ends with `\n[READY]`; extraction echoes user text (to test scrubbing).

## 8. Dependencies

Root `package.json` is owned by the lead. Ask the lead to add a dependency; don't run `pnpm add` yourself.
Installed: next 15, react 19, next-intl 4, ai 7, @ai-sdk/anthropic, @ai-sdk/openai, @supabase/ssr,
@supabase/supabase-js, zod 4, gray-matter, react-markdown, remark-gfm, pdfkit, tailwind 4, shadcn/ui (button, card,
badge, tabs, select, input, sheet, separator, skeleton, alert), clsx, tailwind-merge, cva, lucide-react; dev: vitest,
@testing-library/react, jsdom, tsx, dotenv, @types/pdfkit, pdfjs-dist. Scripts: `db:seed` = `tsx supabase/scripts/build-seed.ts`.

## 9. Changelog
- v0.1 (Phase 0): initial draft by lead.
- v0.2 (Phase 0, 2026-11-15): agreed by all five teammates. ERROR_MARKER for all streams; `[READY]` only as final
  bytes; messages must start and end with `user`; 20k-char conversation cap; consent_version literal +
  `consent_outdated`; delete token + GET/DELETE `/api/report/:id`; shared `lib/ai/scrub.ts` (number-shaped tokens and
  phones) re-run on save; hotlines generated from `lib/hotlines.ts`, not in help.json; `source_url` on contacts and
  businesses with phone rules; `PRICE_UNITS` enum; `notes_zh`; `match_legal.lang` qualification; content_hash covers
  frontmatter; `createAnonClient`, `deleteMissingDocs`, db error classes; no `server-only` (ESLint rule instead);
  pdfkit for PDF; honest rate-limit scope; prompt changes approved (is_fixed_by_law, no example numbers, fixed zh
  disclaimer).
- v0.3 (Phase 2, 2026-11-15, lead): sample mode legal search runs in memory over `content/legal` (ai's
  `/api/chat`); new optional `LEGAL_CONTENT_DIR`.
- v0.4 (Phase 3, 2026-11-20, lead): `CONSENT_VERSION`, `MAX_CONVERSATION_CHARS` and the new `MAX_CONVERSATION_MESSAGES` (60)
  and `MAX_MESSAGE_CHARS` (4000) moved to the zod-free `types/protocol.ts` (re-exported from `types/api.ts`, shapes
  unchanged) so client components can import them without zod.
  `POST /api/report/generate`: `messages[0]` must be `user`; the last message MAY be `assistant` (the client sends the
  whole conversation, ending with the `[READY]` read-back reply), same size limits as `Conversation`.
