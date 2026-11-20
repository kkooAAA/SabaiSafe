Create an agent team to build the SabaiSafe MVP described in CLAUDE.md. Read CLAUDE.md and lib/ai/prompts.ts first.

You are the team lead: you coordinate the team and don't write feature code yourself. Spawn 5 teammates with these names and roles:

1. **frontend**: Next.js pages, components, i18n (en/zh), mobile-first UI for all 4 features.
2. **backend**: Supabase schema and migrations, pgvector, the `match_legal` RPC, seed data, and the price/help API routes.
3. **ai**: the RAG pipeline (ingest script, query rewrite, retrieval, cited answers), the Report Assistant (interview → JSON extraction → Thai summary → PDF), and the Fair Price explanation, all using the prompts in lib/ai/prompts.ts.
4. **content**: DRAFT legal Markdown files (about 15 topics most relevant to Phuket tourists: taxi/tuk-tuk fares, jet ski damage claims, motorbike rental and passports held as deposit, overcharging and price display rules, alcohol hours, vaping, drones, beach rules, drugs/cannabis, gambling, police procedure for foreigners, consumer complaints), in English and Chinese, plus sample prices.csv and help.json. Every file has status DRAFT; never invent section numbers.
5. **qa**: reviews every teammate's work, writes tests and an eval set of 40 questions in en/zh with expected sources, and actively challenges weak work. Message the owner directly with specific problems.

How to work:
- Require plan approval: each teammate sends you a short plan before changing any files.
- Phase 0 (first): you write docs/contracts.md (DB schema, API request/response shapes, shared types). backend, ai and frontend must review it and agree by messaging each other before anyone builds. Set up the repo skeleton, .env.example and CI yourself.
- Then put the tasks in the shared task list with dependencies. Build in this order:
  Phase 1: app shell + i18n + DB + seed data + Help page + Fair Price lookup
  Phase 2: Legal Guide (ingest content → RAG → cited answers in the UI)
  Phase 3: Report Assistant (chat → Thai summary → PDF, with a PDPA consent step)
  Phase 4: Trusted Services, a simple admin page for editing prices and businesses, polish, eval run
- Teammates must talk to each other directly when they depend on each other (e.g. frontend asks ai about the streaming format; ai asks backend about the RPC signature; content asks ai about the frontmatter that ingest expects). Don't route everything through the lead.
- Each teammate edits only its own folders (see CLAUDE.md). To change another teammate's file, message the owner.
- After each phase: run typecheck, lint, tests and the eval set; qa gives a pass/fail report; then stop and give me a short summary (what works, what's broken, what needs a human: API keys, Supabase project, legal verification) before starting the next phase.
- Don't ask me questions you can resolve from CLAUDE.md. Do ask before: adding a paid service, changing the tech stack, or deleting anything.

Start Phase 0 now.
