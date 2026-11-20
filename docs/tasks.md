# Shared task list

Status: `todo` · `doing` · `review` (qa reviewing) · `done` · `blocked`. Update your own rows only (lead updates the rest).
`deps` = task IDs that must be `done` (or have their interface agreed) first.

## Phase 0 — contracts & skeleton
| ID | Task | Owner | Deps | Status |
|---|---|---|---|---|
| P0-1 | Repo skeleton, CI, .env.example, middleware (i18n, rate limit, admin auth) | lead | – | done |
| P0-2 | docs/contracts.md v0.1 + types/api.ts | lead | – | done |
| P0-3 | Review contracts; agree with peers by direct message | backend, ai, frontend | P0-2 | done |
| P0-4 | Review contracts for testability; propose test plan | qa | P0-2 | done |
| P0-5 | Content plan: topic list, file names, source list | content | P0-2 | done |

## Phase 1 — app shell, DB, seed, Help, Fair Price lookup
| ID | Task | Owner | Deps | Status |
|---|---|---|---|---|
| P1-1 | Migrations: all 5 tables, RLS, pgvector, `match_legal`, pg_cron cleanup | backend | P0-3 | done |
| P1-2 | `types/db.ts`, `lib/db/*` with sample mode (in-memory from content/) | backend | P1-1, P1-5 | done |
| P1-3 | `GET /api/price`, `GET /api/help` + seed generator → `supabase/seed.sql` | backend | P1-2 | done |
| P1-4 | App shell: layout, nav, emergency strip, language switch, home tiles, 375px | frontend | P0-3 | done |
| P1-5 | `content/prices.csv` (≥25 sample rows), `content/help.json` (sample entries; NO hotlines — backend adds them from lib/hotlines.ts) | content | P0-3 | done |
| P1-6 | Help page (contacts + hotlines fallback) | frontend | P1-3, P1-4 | done |
| P1-7 | Fair Price lookup page (picker + reference table, source + date shown) | frontend | P1-3, P1-4 | done |
| P1-8 | `lib/ai/provider.ts` + mock mode, `scrub.ts` (ship first), `stream.ts`, approved prompts.ts edits; `POST /api/chat/price` | ai | P1-2 | done |
| P1-9 | Tests: db sample mode, price/help routes, rate limit, hotline-only check | qa | P1-3 | done |

## Phase 2 — Legal Guide
| ID | Task | Owner | Deps | Status |
|---|---|---|---|---|
| P2-1 | ~15 DRAFT topics × en/zh in `content/legal/` | content | P0-5 | done |
| P2-2 | `scripts/ingest.ts` (chunk on ##, hash, embed, upsert, delete stale) | ai | P1-1, P2-1 | done |
| P2-3 | RAG pipeline + `POST /api/chat` (rewrite → match → threshold → cited stream) | ai | P2-2 | done |
| P2-4 | Legal Guide UI: ask box, streamed answer, citations, draft badges, disclaimer, emergency banner | frontend | P2-3 contract | done |
| P2-5 | Eval set: 40 questions en/zh with expected slugs + `evals/run.ts` | qa | P2-1 | done |

## Phase 3 — Report Assistant
| ID | Task | Owner | Deps | Status |
|---|---|---|---|---|
| P3-1 | `/api/report/chat`, `/api/report/generate` (extract, scrub, Thai) | ai | P1-8 | done |
| P3-2 | `/api/report/pdf` (pdfkit, Sarabun + Noto Sans SC); `/api/report/save`; `GET`/`DELETE /api/report/:id` | ai | P3-1, P3-3 | done |
| P3-3 | `lib/db/reports.ts` (save/get/delete with token hash) + expiry | backend | P1-1 | done |
| P3-4 | Report UI: notice → chat → preview → PDF → consent + save | frontend | P3-1 | done |
| P3-5 | Tests: [READY] handling, passport scrub, consent required, PDF renders Thai | qa | P3-2 | done |

## Phase 4 — Trusted Services, admin, polish, eval
| ID | Task | Owner | Deps | Status |
|---|---|---|---|---|
| P4-1 | Trusted Services list (criteria chips, Sponsored label) | frontend | P1-6 | todo |
| P4-2 | `/api/admin/*` CRUD for prices and businesses | backend | P1-3 | todo |
| P4-3 | Admin page | frontend | P4-2 | todo |
| P4-4 | Polish, a11y, 375px pass in en/zh | frontend | all | todo |
| P4-5 | Full eval run + final qa report | qa | all | todo |
