# SabaiSafe

Safety and legal information for foreign tourists in Phuket: Legal Guide, Report Assistant, Fair Price,
Help & Trusted Services. English and Simplified Chinese.

- Project rules and team ownership: `CLAUDE.md`
- Contracts (DB, API, types): `docs/contracts.md`
- Task list: `docs/tasks.md` · Progress log: `docs/progress.md`

## Run locally
```bash
pnpm install
cp .env.example .env.local   # AI_PROVIDER=mock works with no keys and no Supabase
pnpm dev                      # http://localhost:3000/en (Turbopack)
pnpm typecheck && pnpm lint && pnpm test
```
`pnpm dev` uses Turbopack, so each page compiles quickly the first time you open it. If a dev-only problem looks
bundler-related, compare with `pnpm dev:webpack`. Restart the dev server after editing `.env.local`; it is read only at startup.
Dev mode is always slower than production: to judge real page speed, run `pnpm build && pnpm start`.

With a Supabase project: apply `supabase/migrations`, load `supabase/seed.sql`, set the keys, then `pnpm ingest`.
