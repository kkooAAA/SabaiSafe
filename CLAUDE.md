# SabaiSafe — Project Context (read by every teammate)

Full proposal: `docs/proposal.md`

## What we are building
A mobile-first web app for foreign tourists in Phuket, Thailand. It has 4 features:
1. **Legal Guide**: search Thai laws and local rules by topic or location, answered by RAG with citations.
2. **Report Assistant**: an AI chat that collects incident facts and writes a formal Thai summary
   (plus an English copy) that the tourist brings to the police. It does NOT file reports.
3. **Fair Price**: reference prices for goods and services (taxi, tuk-tuk, jet ski, rentals) from
   government and field data, each with its source and collection date.
4. **Help & Trusted Services**: emergency hotlines, police stations, hospitals, embassies, and
   businesses that meet basic criteria (sponsored listings clearly labelled).

Languages: English (default) and Simplified Chinese for the interface and answers. Thai is used only for the report output.

## Tech stack (do not change without the lead's approval)
- Next.js 15 (App Router) + TypeScript (strict) + Tailwind + shadcn/ui
- next-intl for i18n, with routes under `app/[locale]/` where locale = `en` | `zh`
- Supabase: Postgres + pgvector + Storage; `@supabase/ssr` for clients
- Vercel AI SDK (`ai` package) for streaming chat; provider set by env `AI_PROVIDER`
- Providers: `AI_PROVIDER` = `anthropic` | `openai` | `google` | `mock` (Google/Gemini added 2026-11-20, user-approved)
- Embeddings (1536 dims): OpenAI `text-embedding-3-small`, or Google `gemini-embedding-001` at 1536 dims when
  `EMBEDDING_PROVIDER=google` (the default with `AI_PROVIDER=google`). Switching requires a re-ingest.
- Deploy: Vercel
- Package manager: pnpm

## Folder ownership (each teammate edits ONLY its own folders)
| Teammate | Owns |
|---|---|
| frontend | `app/[locale]/**` (pages, layouts), `components/**`, `messages/*.json`, `i18n/**` |
| backend | `supabase/**` (migrations, seed.sql), `lib/db/**`, `app/api/price/**`, `app/api/help/**`, `types/db.ts` |
| ai | `lib/ai/**`, `app/api/chat/**`, `app/api/report/**`, `scripts/ingest.ts`, `lib/pdf/**` |
| content | `content/legal/**/*.md`, `content/prices.csv`, `content/help.json` |
| qa | `tests/**`, `evals/**`, `.github/workflows/**` |
| lead | root config files (incl. `package.json`, `middleware.ts`), `README.md`, this `CLAUDE.md`, `.env.example`, `docs/contracts.md`, `docs/tasks.md`, `lib/hotlines.ts`, `lib/rate-limit.ts`, `lib/utils.ts`, `types/api.ts` (changes need frontend+backend+ai agreement) |

Additions agreed in Phase 0: backend also owns `app/api/admin/**`; ai's `app/api/chat/**` includes
`/api/chat/price` (Fair Price explanation). Anyone may append to `docs/progress.md`. Dependencies: ask the lead.

To change a file you don't own, **message its owner** and ask. Never edit another teammate's files.
Shared types live in `types/`. backend owns `types/db.ts`, and anyone may ADD a new file in `types/`.

## Contracts (agree on these before building; the lead records them in `docs/contracts.md`)
- DB tables: `legal_chunks`, `prices`, `businesses`, `help_contacts`, `reports`
- RPC: `match_legal(query_embedding vector(1536), match_count int, lang text)`
- API routes:
  - `POST /api/chat` `{question, lang}`: streamed answer, followed by a sources JSON
  - `POST /api/report/chat` `{messages, lang}`: streamed interview reply
  - `POST /api/report/generate` `{messages}` → `{facts, markdown}`; PDF via `/api/report/pdf`
  - `POST /api/report/save` (consent required) → `{id, expires_at, delete_token}`; `GET`/`DELETE /api/report/:id`
  - `POST /api/chat/price` `{item, quoted, area, lang}`: streamed Fair Price explanation
  - `GET /api/price?item=&area=` → reference rows
  - `GET /api/help?category=` → contacts and businesses
- Prompts: use `lib/ai/prompts.ts` as given (owned by ai). Changes need the lead's OK.

## Content format (content/legal)
One Markdown file per topic, with frontmatter:
```yaml
title: "Taxi and tuk-tuk fares"
law: "Land Transport Act B.E. 2522"
law_th: "พ.ร.บ.การขนส่งทางบก พ.ศ. 2522"
section: "..."
location: "Phuket" # or "Patong Beach", etc.
lang: "en"         # en | zh
source_url: "https://..."
status: "DRAFT"    # DRAFT until a human on the legal team verifies it -> "VERIFIED"
```
AI-written legal content is ALWAYS `status: DRAFT`. Never invent section numbers. If unsure, write
`section: "TO VERIFY"`. The ingest script indexes DRAFT content, but the UI shows a "draft" badge.

## Non-negotiable rules
- Legal answers come ONLY from retrieved sources and always show citations and a disclaimer.
- Hotlines: Tourist Police 1155, Police 191, Ambulance 1669, Consumer Protection Board (สคบ.) 1166.
  The Help page shows them; the AI must never make up other numbers.
- PDPA: a report is stored only after an explicit consent checkbox. Store no passport numbers.
  Delete reports automatically after 30 days.
- No API keys in client code. All LLM calls go through server routes. Rate-limit `/api/*`.
- Seed realistic FAKE data, marked `is_sample = true`, so the demo works before real data arrives.

## Definition of done (for every task)
- `pnpm typecheck && pnpm lint && pnpm test` pass
- Works on a 375px-wide mobile screen in both `en` and `zh`
- qa has reviewed it and any issues are resolved
- A short note was added to `docs/progress.md`
