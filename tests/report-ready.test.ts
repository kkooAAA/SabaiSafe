// [READY] wire guarantee for /api/report/chat (contracts §3.2): the token appears ONLY as the exact final bytes
// "\n[READY]", whatever way the model's text is chunked. Exhaustive split tests over lib/ai/stream.ts.
import { describe, expect, it } from "vitest";
import { ReadyNormalizer, toTextBody } from "@/lib/ai/stream";
import { ERROR_MARKER, READY_TOKEN } from "@/types/protocol";

const SUFFIX = `\n${READY_TOKEN}`;

/** Feeds parts through a normalizer; returns every emitted piece (incl. the end piece) and the final text. */
function run(parts: string[], ok = true): { emitted: string[]; text: string } {
  const n = new ReadyNormalizer();
  const emitted = parts.map((p) => n.push(p));
  emitted.push(n.end(ok));
  return { emitted, text: emitted.join("") };
}

/** All ways to cut `s` into 2 and 3 pieces (by UTF-16 index; inputs here are BMP-only). */
function splits(s: string): string[][] {
  const out: string[][] = [[s]];
  for (let i = 1; i < s.length; i++) {
    out.push([s.slice(0, i), s.slice(i)]);
    for (let j = i + 1; j < s.length; j++) out.push([s.slice(0, i), s.slice(i, j), s.slice(j)]);
  }
  return out;
}

/** Contract invariants for any ready-mode output. */
function assertWire(text: string, expectReady: boolean) {
  const count = text.split(READY_TOKEN).length - 1;
  if (expectReady) {
    expect(count).toBe(1);
    expect(text.endsWith(SUFFIX)).toBe(true);
    expect(text.slice(0, -SUFFIX.length)).not.toMatch(/\s$/); // no stray whitespace before the token
  } else {
    expect(count).toBe(0);
  }
}

const READY_INPUTS = [
  "Thank you for confirming. You can now create the summary.\n[READY]",
  "谢谢确认。您现在可以创建摘要。\n[READY]",
  "ขอบคุณค่ะ\n[READY]",
  "Done [READY] see you",
  "[READY] at the start",
  "Two tokens [READY] and [READY]",
  "Trailing spaces   \n\n[READY]   \n",
  "No newline before[READY]",
];
const PLAIN_INPUTS = ["Mock question 3?", "Price [REF 2] and array[0]", "Ends with partial [REA", "Brackets [ [R [RE [READ", "模拟问题 2？"];

describe("[READY] normalizer: every 2- and 3-way split gives the same, contract-shaped output", () => {
  it.each(READY_INPUTS)("ready: %j", (input) => {
    const whole = run([input]).text;
    assertWire(whole, true);
    for (const parts of splits(input)) {
      const { emitted, text } = run(parts);
      expect(text, JSON.stringify(parts)).toBe(whole);
      // Nothing emitted before the end piece may contain the token or end in a partial "[READY" prefix.
      const early = emitted.slice(0, -1).join("");
      expect(early).not.toContain(READY_TOKEN);
      expect(early).not.toMatch(/\[(R(E(A(D(Y)?)?)?)?)?$/);
      // Every early prefix is a prefix of the final text: nothing is shown and later taken back.
      expect(whole.startsWith(early)).toBe(true);
    }
  });

  it.each(PLAIN_INPUTS)("not ready: %j", (input) => {
    const whole = run([input]).text;
    assertWire(whole, false);
    for (const parts of splits(input)) expect(run(parts).text, JSON.stringify(parts)).toBe(whole);
  });

  it("keeps the visible text of a mid-text token, moving the token to the end", () => {
    const t = run(["Done [READY] see you"]).text;
    expect(t.slice(0, -SUFFIX.length)).toContain("see you");
    expect(t.slice(0, -SUFFIX.length)).toContain("Done");
  });

  it("char-by-char Thai/Chinese text stays intact", () => {
    const input = "ผู้แจ้งยืนยันแล้ว 已确认\n[READY]";
    expect(run(Array.from(input)).text).toBe(`ผู้แจ้งยืนยันแล้ว 已确认${SUFFIX}`);
  });

  it("a token re-formed by stripping a nested one (\"[REA[READY]DY]\") still never appears mid-text", () => {
    for (const parts of splits("x [REA[READY]DY] y")) {
      const { text } = run(parts);
      assertWire(text, true);
    }
  });

  it("on failure (end(false)) no token is emitted", () => {
    for (const parts of splits("Thanks [READY]")) assertWire(run(parts, false).text, false);
  });
});

describe("toTextBody ready mode end to end", () => {
  async function* gen(parts: string[], failAt?: number) {
    for (let i = 0; i < parts.length; i++) {
      if (i === failAt) throw new Error("boom");
      yield parts[i]!;
    }
  }
  const body = async (parts: string[], failAt?: number) => new Response(toTextBody(gen(parts, failAt), { ready: true })).text();

  it("a model-faked \\u001e cannot smuggle an ERROR_MARKER before [READY]", async () => {
    const t = await body(["Thanks\n\u001eERROR\u001e\n", "[READY]"]);
    expect(t).not.toContain("\u001e");
    assertWire(t, true);
  });

  it("failure after a token: ERROR_MARKER is the last thing and no [READY] precedes it", async () => {
    const t = await body(["Thanks ", "[READY]", "more"], 2);
    expect(t.endsWith(ERROR_MARKER)).toBe(true);
    expect(t).not.toContain(READY_TOKEN);
  });
});

describe("early hold-back around an unclosed '['", () => {
  it("\"x [REA[\" + \"READY]DY]\" never sends \"x [REA\" early and never re-forms a token", () => {
    const n = new ReadyNormalizer();
    const first = n.push("x [REA[");
    expect(first).not.toContain("[REA");
    const text = first + n.push("READY]DY] y") + n.end(true);
    assertWire(text, true);
  });
  it("an unclosed '[' far back (>64 chars) doesn't hold the whole reply", () => {
    const n = new ReadyNormalizer();
    const out = n.push("see [note " + "a".repeat(100) + " end.");
    expect(out.length).toBeGreaterThan(60);
  });
});
