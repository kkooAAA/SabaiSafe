// Static checks over the source tree: secrets stay on the server, client code never touches lib/db or lib/ai,
// and every API route declares the Node runtime (contracts §3).
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { execFileSync } from "node:child_process";

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
      // Only exception (lead, P4-3): the pure validation module @/lib/db/schema (checked below).
      .map((f) => [f, src(f).replace(/["']@\/lib\/db\/schema["']/g, '"<schema>"')] as const)
      .filter(([, code]) => /from\s+["'](@\/|\.{1,2}\/)+(lib\/)?(db|ai)(\/|["'])/.test(code) || /["']@\/lib\/(db|ai)/.test(code))
      .map(([f]) => f);
    expect(bad.map(rel)).toEqual([]);
  });

  it("lib/db/schema.ts (importable by the admin client) imports only zod and @/types/*", () => {
    const code = src(join(ROOT, "lib", "db", "schema.ts"));
    const specs = [...code.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']/g)].map(
      (m) => m[1] ?? m[2] ?? m[3],
    );
    expect(specs.length).toBeGreaterThan(0);
    expect(specs.filter((s) => s !== "zod" && !/^@\/types\/[\w-]+$/.test(s!))).toEqual([]);
    expect(code).not.toMatch(/process\.env|server-only/);
  });

  it("only the admin UI imports @/lib/db/schema from client-side folders (keeps zod out of public pages)", () => {
    const bad = files
      .filter((f) => /^(components|app\/\[locale\]|i18n)\//.test(rel(f)) && !rel(f).startsWith("components/admin/"))
      .filter((f) => /["'](@\/|(\.\.\/)+)lib\/db\/schema["']/.test(src(f)));
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

  it("the admin page is not linked from public code (nav, header, home, footer, any page)", () => {
    const isAdminCode = (f: string) => /^(components\/admin\/|app\/\[locale\]\/admin\/|app\/api\/admin\/)/.test(rel(f));
    const bad = files
      .filter((f) => /^(app|components)\//.test(rel(f)) && !isAdminCode(f))
      .filter((f) => /["'`](\/(en|zh|\$\{[^}]+\}))?\/admin["'`/?#]/.test(src(f)) || /href=\{?["'`][^"'`]*\/admin\b/.test(src(f)));
    expect(bad.map(rel)).toEqual([]);
  });

  it("the admin page sets robots noindex, and next.config adds X-Robots-Tag for admin pages and API", () => {
    expect(src(join(ROOT, "app", "[locale]", "admin", "page.tsx"))).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*false/);
    const cfg = src(join(ROOT, "next.config.ts"));
    expect(cfg).toMatch(/X-Robots-Tag[\s\S]*noindex/);
    expect(cfg).toContain("/api/admin/:path*");
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
      [...src(f).matchAll(/NEXT_PUBLIC_[A-Z0-9_]*(SERVICE_ROLE|SECRET|API_KEY|PASSWORD|OPENAI|ANTHROPIC|GOOGLE_GENERATIVE|GEMINI)[A-Z0-9_]*/g)].map(
        (m) => `${rel(f)}: ${m[0]}`,
      ),
    );
    expect(bad).toEqual([]);
  });

  it("no hard-coded API keys", () => {
    const bad = files.filter((f) => /\b(sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|eyJhbGciOi[A-Za-z0-9._-]{40,})/.test(src(f)));
    expect(bad.map(rel)).toEqual([]);
  });

  it("no committable file assigns a value to a secret env var (format-independent; .env/.env*.local are ignored)", () => {
    // Every file git would commit (tracked + untracked-not-ignored), any extension. Catches keys of any prefix.
    const committable = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: ROOT, encoding: "utf8" })
      .split("\0")
      .filter((f) => f && !f.startsWith("node_modules/") && existsSync(join(ROOT, f)) && statSync(join(ROOT, f)).isFile());
    const SECRET_ASSIGN =
      /^\s*(?:export\s+)?(GOOGLE_GENERATIVE_AI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|SUPABASE_SERVICE_ROLE_KEY|ADMIN_PASSWORD)\s*[=:]\s*["']?([^\s"'#]+)/gm;
    const bad: string[] = [];
    for (const f of committable) {
      if (statSync(join(ROOT, f)).size > 2_000_000) continue;
      const text = readFileSync(join(ROOT, f), "utf8");
      for (const m of text.matchAll(SECRET_ASSIGN)) {
        const value = m[2] ?? "";
        // Placeholders and env references are fine; a literal value is not.
        if (/^(\$\{?|<|your[-_]|changeme$|xxx|\.\.\.|test-not-a-real-key$|\$\{\{)/i.test(value)) continue;
        bad.push(`${f}: ${m[1]}`); // never print the value
      }
    }
    expect(bad).toEqual([]);
    // the ignore rules that keep real keys out stay in place
    const gi = readFileSync(join(ROOT, ".gitignore"), "utf8");
    expect(gi).toMatch(/^\.env$/m);
    expect(gi).toMatch(/^\.env\*\.local$/m);
  });

  it("SUPABASE_SERVICE_ROLE_KEY is read only inside lib/db (no server-only package, so keep the surface tiny)", () => {
    const bad = files.filter((f) => !rel(f).startsWith("lib/db/") && /SUPABASE_SERVICE_ROLE_KEY/.test(src(f)));
    expect(bad.map(rel)).toEqual([]);
  });

  it("LLM keys are read only inside lib/ai", () => {
    const bad = files.filter((f) => !rel(f).startsWith("lib/ai/") && /(OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY)/.test(src(f)));
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
