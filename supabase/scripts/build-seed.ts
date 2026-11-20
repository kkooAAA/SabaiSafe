// Generates supabase/seed.sql from content/prices.csv + content/help.json + lib/hotlines.ts.
// Owner: backend. Run: `pnpm db:seed` (tsx). Uses the same validation as sample mode (lib/db/sample.ts),
// so invalid content fails here with a file:line message. Output is idempotent (on conflict do nothing).
// Env SAMPLE_DATA_DIR overrides the content directory; `--out <file>` or SEED_OUT overrides the output file. With SAMPLE_DATA_DIR
// set (e.g. test fixtures), SEED_OUT is required so a test run can never overwrite the real supabase/seed.sql.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadSeedData, readSampleFiles, sampleDataDir } from "@/lib/db/sample";
import { buildSeedSql } from "@/lib/db/seed-sql";

const dir = sampleDataDir();
const { csvText, helpJson } = readSampleFiles(dir);
const data = loadSeedData(csvText, helpJson);
const outArg = process.argv.indexOf("--out");
const seedOut = (outArg >= 0 ? process.argv[outArg + 1] : undefined)?.trim() || process.env.SEED_OUT?.trim();
if (process.env.SAMPLE_DATA_DIR?.trim() && !seedOut) {
  console.error("SAMPLE_DATA_DIR is set: also pass --out <file> or set SEED_OUT so supabase/seed.sql is not overwritten.");
  process.exit(1);
}
const out = path.resolve(process.cwd(), seedOut || "supabase/seed.sql");
writeFileSync(out, buildSeedSql(data), "utf8");
console.log(
  `${path.relative(process.cwd(), out)}: ${data.prices.length} prices, ${data.contacts.length} contacts (incl. 4 hotlines), ${data.businesses.length} businesses from ${dir}`,
);
