// Legal content ingest CLI: `pnpm ingest [--dry-run] [--force] [--dir <path>] [--json] [--allow-mock]`.
// Reads content/legal/{en,zh}/*.md, chunks on "##", hashes, embeds changed chunks (OpenAI text-embedding-3-small,
// or deterministic mock vectors when AI_PROVIDER=mock), upserts into legal_chunks and deletes stale chunks.
//
//   --dry-run   no database access and no API calls (mock embeddings); validates frontmatter and chunking.
//   --force     re-embed every chunk, even when its content_hash is unchanged.
//   --dir <p>   content root (default: content/legal, or LEGAL_CONTENT_DIR).
//   --json      print the final report as one JSON line.
//   --allow-mock  allow a real (non-dry) run with AI_PROVIDER=mock, which stores MOCK vectors (demo DBs only).
// Env: .env.local / .env are loaded. A real run needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and,
// unless AI_PROVIDER=mock, OPENAI_API_KEY.
import path from "node:path";
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

type Args = { dryRun: boolean; force: boolean; dir?: string; json: boolean; help: boolean; allowMock: boolean };

function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, force: false, json: false, help: false, allowMock: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!;
    if (v === "--dry-run") a.dryRun = true;
    else if (v === "--force") a.force = true;
    else if (v === "--json") a.json = true;
    else if (v === "--allow-mock") a.allowMock = true;
    else if (v === "--help" || v === "-h") a.help = true;
    else if (v === "--dir") a.dir = argv[++i];
    else if (v.startsWith("--dir=")) a.dir = v.slice(6);
    else if (v === "--") continue;
    else throw new Error(`Unknown argument: ${v}`);
  }
  if (a.dir === "") throw new Error("--dir needs a path");
  return a;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: pnpm ingest [--dry-run] [--force] [--dir <path>] [--json] [--allow-mock]");
    return 0;
  }
  // Imported after dotenv so modules see the env.
  const { legalContentDir } = await import("@/lib/ai/legal-content");
  const { runIngest } = await import("@/lib/ai/ingest");
  const { aiProvider } = await import("@/lib/ai/provider");
  const { isSampleMode } = await import("@/lib/db/client");
  const db = await import("@/lib/db/legal");

  const dir = args.dir ? path.resolve(args.dir) : legalContentDir();
  const log = (s: string) => console.error(`[ingest] ${s}`);

  if (!args.dryRun) {
    if (isSampleMode()) {
      log("NEXT_PUBLIC_SUPABASE_URL is empty (sample mode). Set the Supabase env vars, or run with --dry-run.");
      return 2;
    }
    if (aiProvider() === "mock") {
      if (!args.allowMock) {
        log("AI_PROVIDER=mock would store MOCK embeddings in the database (and --force would overwrite real ones). Use --dry-run, set a real provider, or pass --allow-mock for a demo DB.");
        return 2;
      }
      log("warning: --allow-mock: MOCK embeddings will be stored; real queries won't match them.");
    }
  }

  const report = await runIngest({ dir, dryRun: args.dryRun, force: args.force, store: args.dryRun ? undefined : db, log });
  if (args.json) console.log(JSON.stringify(report));
  else log("done");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`[ingest] failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
