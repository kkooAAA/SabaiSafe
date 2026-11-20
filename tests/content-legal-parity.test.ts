// content/legal en/zh parity and raw-frontmatter rules (contracts §5), on top of content-legal.test.ts.
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";

const ROOT = join(process.cwd(), "content", "legal");
const HIGH_PRIORITY = ["drugs-and-cannabis", "vaping-e-cigarettes"];

type Doc = { raw: string; data: Record<string, unknown>; body: string };
function load(lang: "en" | "zh"): Map<string, Doc> {
  const dir = join(ROOT, lang);
  if (!existsSync(dir)) return new Map();
  return new Map(
    readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const raw = readFileSync(join(dir, f), "utf8");
        const p = matter(raw);
        return [f.replace(/\.md$/, ""), { raw, data: p.data as Record<string, unknown>, body: p.content }] as const;
      }),
  );
}
const en = load("en");
const zh = load("zh");
const pairs = [...en.keys()].filter((s) => zh.has(s)).map((s) => [s, en.get(s)!, zh.get(s)!] as const);

function frontmatterLines(raw: string): string[] {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m?.[1] ? m[1].split(/\r?\n/).filter((l) => l.trim() !== "") : [];
}

describe.runIf(pairs.length > 0)("content/legal parity", () => {
  it.each(pairs)("%s: en and zh have the same number of ## sections", (_s, e, z) => {
    const n = (b: string) => b.split(/\r?\n/).filter((l) => /^## /.test(l)).length;
    expect(n(z.body)).toBe(n(e.body));
  });

  it.each(pairs)("%s: en and zh share source_url, location, updated, verify_priority", (_s, e, z) => {
    for (const k of ["source_url", "location", "updated", "verify_priority"]) expect(z.data[k], k).toEqual(e.data[k]);
  });

  it.each(pairs)("%s: zh keeps at least as many TO VERIFY markers as en", (_s, e, z) => {
    const count = (b: string) => (b.match(/TO VERIFY/g) ?? []).length;
    expect(count(z.body)).toBeGreaterThanOrEqual(count(e.body));
  });

  it("fast-changing topics carry verify_priority: high", () => {
    for (const slug of HIGH_PRIORITY) {
      for (const [lang, m] of [["en", en], ["zh", zh]] as const) {
        expect(m.get(slug)?.data.verify_priority, `${lang}/${slug}`).toBe("high");
      }
    }
  });

  it("verify_priority is only ever \"high\"", () => {
    for (const m of [en, zh]) for (const [slug, d] of m) if ("verify_priority" in d.data) expect(d.data.verify_priority, slug).toBe("high");
  });

  it("every frontmatter value is double-quoted (gray-matter would turn dates into Date objects)", () => {
    for (const [lang, m] of [["en", en], ["zh", zh]] as const) {
      for (const [slug, d] of m) {
        for (const line of frontmatterLines(d.raw)) expect(line, `${lang}/${slug}`).toMatch(/^[a-z_]+: ".*"$/);
      }
    }
  });

  it("no unexpected frontmatter keys", () => {
    const allowed = new Set(["title", "law", "law_th", "section", "location", "lang", "source_url", "status", "topic", "updated", "verify_priority"]);
    for (const m of [en, zh]) for (const [slug, d] of m) for (const k of Object.keys(d.data)) expect(allowed.has(k), `${slug}: ${k}`).toBe(true);
  });
});
