// content/legal/{en,zh}/*.md invariants (CLAUDE.md content format, contracts §5).
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import type { LegalTopic } from "@/types/api";
import { HOTLINE_NUMBERS } from "@/lib/hotlines";
import { findPhoneLike } from "./helpers/phones";

const ROOT = join(process.cwd(), "content", "legal");
const LANGS = ["en", "zh"] as const;
const TOPICS: LegalTopic[] = ["scam", "price", "transport", "rental", "alcohol_drugs", "beach_rules", "accommodation", "police_procedure", "visa_immigration", "other"];
const REQUIRED = ["title", "law", "law_th", "section", "location", "lang", "source_url", "status", "topic", "updated"] as const;

type Doc = { lang: (typeof LANGS)[number]; slug: string; file: string; data: Record<string, unknown>; body: string };

const docs: Doc[] = existsSync(ROOT)
  ? LANGS.flatMap((lang) =>
      existsSync(join(ROOT, lang))
        ? readdirSync(join(ROOT, lang))
            .filter((f) => f.endsWith(".md"))
            .map((f) => {
              const file = join(ROOT, lang, f);
              const parsed = matter(readFileSync(file, "utf8"));
              return { lang, slug: f.replace(/\.md$/, ""), file: `${lang}/${f}`, data: parsed.data as Record<string, unknown>, body: parsed.content };
            })
        : [],
    )
  : [];

/** Body with the hotline numbers and 4-digit years removed: anything numeric left must be justified. */
function stripAllowedNumbers(s: string) {
  return s.replace(/\b(1155|191|1669|1166)\b/g, "").replace(/\b(19|20|24|25)\d{2}\b/g, "");
}

describe.runIf(docs.length > 0)("content/legal", () => {
  it("every slug exists in both en and zh", () => {
    const en = new Set(docs.filter((d) => d.lang === "en").map((d) => d.slug));
    const zh = new Set(docs.filter((d) => d.lang === "zh").map((d) => d.slug));
    expect([...en].filter((s) => !zh.has(s)), "missing zh").toEqual([]);
    expect([...zh].filter((s) => !en.has(s)), "missing en").toEqual([]);
  });

  it("slugs are kebab-case", () => {
    for (const d of docs) expect(d.slug, d.file).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it.each(docs.map((d) => [d.file, d] as const))("%s frontmatter", (_f, d) => {
    for (const k of REQUIRED) expect(d.data, `${d.file}: ${k}`).toHaveProperty(k);
    expect(d.data.lang).toBe(d.lang);
    expect(d.data.status, "AI-written content is always DRAFT").toBe("DRAFT");
    expect(TOPICS).toContain(d.data.topic);
    expect(String(d.data.updated)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(d.data.title).trim()).not.toBe("");
    expect(String(d.data.law).trim()).not.toBe("");
    const su = String(d.data.source_url ?? "");
    if (su) expect(su).toMatch(/^https?:\/\//);
    const section = String(d.data.section ?? "");
    expect(section === "TO VERIFY" || (section.length > 0 && su.length > 0), `${d.file}: a real section needs a source_url`).toBe(true);
    if (d.lang === "zh") expect(String(d.data.title)).toMatch(/[一-鿿]/);
    if (d.data.law_th) expect(String(d.data.law_th)).toMatch(/[฀-๿]/);
  });

  it("en and zh versions of a topic share topic, law and section", () => {
    for (const en of docs.filter((d) => d.lang === "en")) {
      const zh = docs.find((d) => d.lang === "zh" && d.slug === en.slug);
      if (!zh) continue;
      for (const k of ["topic", "law_th", "section", "status"] as const) expect(zh.data[k], `${en.slug}.${k}`).toEqual(en.data[k]);
    }
  });

  it.each(docs.map((d) => [d.file, d] as const))("%s body structure", (_f, d) => {
    const lines = d.body.split(/\r?\n/);
    expect(lines.filter((l) => /^# /.test(l)), "exactly one # title").toHaveLength(1);
    const h2 = lines.filter((l) => /^## /.test(l));
    expect(h2.length, "at least 2 ## sections (ingest splits on ##)").toBeGreaterThanOrEqual(2);
    expect(d.body).not.toMatch(/<[a-z][\s\S]*?>/i);
    // Chunks must stay embeddable: no section over ~600 words / 2400 CJK chars.
    for (const sec of d.body.split(/^## /m).slice(1)) {
      const size = d.lang === "zh" ? sec.replace(/\s/g, "").length : sec.split(/\s+/).length;
      expect(size, `${d.file}: section "${sec.split("\n")[0]}" too long`).toBeLessThan(d.lang === "zh" ? 2400 : 600);
      expect(size, `${d.file}: section "${sec.split("\n")[0]}" empty`).toBeGreaterThan(d.lang === "zh" ? 40 : 20);
    }
  });

  it.each(docs.map((d) => [d.file, d] as const))("%s has no invented phone numbers, section numbers or amounts", (_f, d) => {
    const text = `${d.body}\n${String(d.data.title)}\n${String(d.data.law)}`;
    expect(findPhoneLike(text)).toEqual([]);
    // Section numbers must not be invented: "section 12", "มาตรา 12", "第12条" only with a sourced section in frontmatter.
    if (d.data.section === "TO VERIFY") {
      expect(text).not.toMatch(/\b(section|sec\.|article)\s*\d+/i);
      expect(text).not.toMatch(/มาตรา\s*\d+|第\s*\d+\s*条/);
    }
    // Unsourced fines/amounts are written "TO VERIFY": no bare money amounts.
    expect(stripAllowedNumbers(text)).not.toMatch(/\d[\d,.]*\s*(baht|THB|฿|泰铢|铢|บาท)/i);
    expect(stripAllowedNumbers(text)).not.toMatch(/฿\s*\d/);
  });

  it("mentions only the four hotlines as short codes", () => {
    for (const d of docs) {
      for (const m of d.body.matchAll(/(?<![\d.,])\b1\d{2,3}\b(?![\d.,])/g)) {
        expect(HOTLINE_NUMBERS as readonly string[], `${d.file}: ${m[0]}`).toContain(m[0]);
      }
    }
  });

  it("always points to Tourist Police 1155", () => {
    for (const d of docs) expect(d.body, d.file).toContain("1155");
  });
});
