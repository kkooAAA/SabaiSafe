import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";
import { routing } from "@/i18n/routing";

type Tree = { [k: string]: string | Tree };

function keys(t: Tree, prefix = ""): string[] {
  return Object.entries(t).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`)));
}

function leaves(t: Tree): [string, string][] {
  return Object.entries(t).flatMap(([k, v]) =>
    typeof v === "string" ? [[k, v] as [string, string]] : leaves(v).map(([kk, vv]) => [`${k}.${kk}`, vv] as [string, string]),
  );
}

function placeholders(s: string) {
  // Argument names only: "{count}" or "{count, plural, ...}". Plural branch text such as "{No results}" is not an argument.
  return [...new Set([...s.matchAll(/\{\s*(\w+)\s*[,}]/g)].map((m) => m[1] ?? ""))].sort();
}

describe("i18n messages", () => {
  it("locales are en (default) and zh", () => {
    expect(routing.locales).toEqual(["en", "zh"]);
    expect(routing.defaultLocale).toBe("en");
  });

  it("en.json and zh.json have identical key sets", () => {
    const a = keys(en as Tree).sort();
    const b = keys(zh as Tree).sort();
    expect(b.filter((k) => !a.includes(k)), "keys only in zh").toEqual([]);
    expect(a.filter((k) => !b.includes(k)), "keys only in en").toEqual([]);
  });

  it("no empty strings", () => {
    for (const [k, v] of [...leaves(en as Tree), ...leaves(zh as Tree)]) expect(v.trim(), k).not.toBe("");
  });

  it("ICU placeholders match between en and zh", () => {
    const zhMap = new Map(leaves(zh as Tree));
    for (const [k, v] of leaves(en as Tree)) {
      const z = zhMap.get(k);
      if (z !== undefined) expect(placeholders(z), k).toEqual(placeholders(v));
    }
  });

  it("zh strings are actually Chinese (not copied English) for user-visible text", () => {
    const suspicious = leaves(zh as Tree).filter(
      ([, v]) => /[a-z]{4,}/i.test(v) && !/[一-鿿]/.test(v) && !/^(SabaiSafe|PDF|OK|LINE|Google Maps|English)$/i.test(v), // "English" = language switch label
    );
    expect(suspicious.map(([k]) => k)).toEqual([]);
  });

  it("contain no phone numbers other than the hotlines", async () => {
    const { findPhoneLike } = await import("./helpers/phones");
    for (const [k, v] of [...leaves(en as Tree), ...leaves(zh as Tree)]) expect(findPhoneLike(v), k).toEqual([]);
  });
});
