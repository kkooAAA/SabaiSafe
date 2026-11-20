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
pnpm dev                      # http://localhost:3000/en
pnpm typecheck && pnpm lint && pnpm test
```
With a Supabase project: apply `supabase/migrations`, load `supabase/seed.sql`, set the keys, then `pnpm ingest`.
