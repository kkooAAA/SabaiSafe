// Static checks over the source tree: secrets stay on the server, client code never touches lib/db or lib/ai,
// and every API route declares the Node runtime (contracts §3).
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", ".next", ".git", "coverage", "tests", "evals"]);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const files = ["app", "components", "lib", "i18n", "types"].flatMap((d) => walk(join(ROOT, d)));
const rel = (p: string) => relative(ROOT, p).split(sep).join("/");
const src = (p: string) => readFileSync(p, "utf8");
const isClient = (code: string) => /^\s*(["'])use client\1/m.test(code.slice(0, 200));

describe("repo safety", () => {
  it("client components never import lib/db or lib/ai", () => {
    const bad = files
      .filter((f) => isClient(src(f)))
      .filter((f) => /from\s+["'](@\/|\.{1,2}\/)+(lib\/)?(db|ai)(\/|["'])/.test(src(f)) || /["']@\/lib\/(db|ai)/.test(src(f)));
    expect(bad.map(rel)).toEqual([]);
  });

  it("client components import runtime values from @/types/protocol, not @/types/api (keeps zod out of the bundle)", () => {
    // `import type` from types/api is fine (erased); a value import pulls zod into the client bundle.
    const bad = files
      .filter((f) => isClient(src(f)))
      .filter((f) => /^\s*import\s+(?!type\b)[^;]*?from\s+["']@\/types\/api["']/m.test(src(f)));
    expect(bad.map(rel)).toEqual([]);
  });

  it("client components never import pdfkit, lib/pdf, node: built-ins, or supabase service code", () => {
    const bad = files
      .filter((f) => isClient(src(f)))
      .filter((f) => /from\s+["'](pdfkit|pdfjs-dist[^"']*|node:[a-z]+|@\/lib\/pdf[^"']*|fs|crypto|path)["']/.test(src(f)));
    expect(bad.map(rel)).toEqual([]);
  });

  it("the report routes exist and set runtime = nodejs", () => {
    for (const r of ["chat", "generate", "pdf", "save", "[id]"]) {
      const p = join(ROOT, "app", "api", "report", r, "route.ts");
      expect(existsSync(p), p).toBe(true);
      expect(src(p)).toMatch(/export\s+const\s+runtime\s*=\s*["']nodejs["']/);
    }
  });

  it("client components read only NEXT_PUBLIC_ env vars", () => {
    const bad: string[] = [];
    for (const f of files.filter((f) => isClient(src(f)))) {
      for (const m of src(f).matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        const name = m[1] ?? "";
        if (!name.startsWith("NEXT_PUBLIC_") && name !== "NODE_ENV") bad.push(`${rel(f)}: ${name}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("no secret is ever exposed through a NEXT_PUBLIC_ name", () => {
    const bad = files.flatMap((f) =>
      [...src(f).matchAll(/NEXT_PUBLIC_[A-Z0-9_]*(SERVICE_ROLE|SECRET|API_KEY|PASSWORD|OPENAI|ANTHROPIC)[A-Z0-9_]*/g)].map(
        (m) => `${rel(f)}: ${m[0]}`,
      ),
    );
    expect(bad).toEqual([]);
  });

  it("no hard-coded API keys", () => {
    const bad = files.filter((f) => /\b(sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|eyJhbGciOi[A-Za-z0-9._-]{40,})/.test(src(f)));
    expect(bad.map(rel)).toEqual([]);
  });

  it("SUPABASE_SERVICE_ROLE_KEY is read only inside lib/db (no server-only package, so keep the surface tiny)", () => {
    const bad = files.filter((f) => !rel(f).startsWith("lib/db/") && /SUPABASE_SERVICE_ROLE_KEY/.test(src(f)));
    expect(bad.map(rel)).toEqual([]);
  });

  it("LLM keys are read only inside lib/ai", () => {
    const bad = files.filter((f) => !rel(f).startsWith("lib/ai/") && /(OPENAI|ANTHROPIC)_API_KEY/.test(src(f)));
    expect(bad.map(rel)).toEqual([]);
  });

  it("every API route sets runtime = nodejs", () => {
    const routes = files.filter((f) => /app[\\/]api[\\/].*route\.ts$/.test(f));
    const bad = routes.filter((f) => !/export\s+const\s+runtime\s*=\s*["']nodejs["']/.test(src(f)));
    expect(bad.map(rel)).toEqual([]);
  });

  it("no source file hard-codes the hotline list (import lib/hotlines.ts instead)", () => {
    // A tel: link to a hotline must come from HOTLINES, not a literal.
    const bad = files
      .filter((f) => !rel(f).startsWith("lib/hotlines.ts") && !rel(f).startsWith("lib/ai/prompts.ts"))
      .filter((f) => /tel:\s*(1155|191|1669|1166)\b/.test(src(f)));
    expect(bad.map(rel)).toEqual([]);
  });
});
