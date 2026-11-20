// lib/ai/stream.ts wire format: plain text, SOURCES trailer, [READY] normalization, terminal ERROR_MARKER.
import { describe, expect, it, vi } from "vitest";
import { ReadyNormalizer, STREAM_HEADERS, fixedText, textDeltas, textStreamResponse, toTextBody } from "@/lib/ai/stream";
import { ERROR_MARKER, READY_TOKEN, SOURCES_DELIMITER } from "@/types/api";

async function* gen(parts: string[], failAfter?: number) {
  for (let i = 0; i < parts.length; i++) {
    if (failAfter !== undefined && i === failAfter) throw new Error("boom");
    yield parts[i]!;
  }
}

async function read(body: ReadableStream<Uint8Array>): Promise<{ text: string; chunks: string[] }> {
  const dec = new TextDecoder();
  const chunks: string[] = [];
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(dec.decode(value, { stream: true }));
  }
  return { text: chunks.join(""), chunks };
}

describe("toTextBody", () => {
  it("streams text unchanged without a trailer", async () => {
    expect((await read(toTextBody(gen(["Hel", "lo ", "world"])))).text).toBe("Hello world");
  });

  it("appends SOURCES_DELIMITER + one JSON line after the text", async () => {
    const { text } = await read(toTextBody(gen(["Answer [1]"]), { trailer: () => ({ sources: [{ id: 1 }], meta: { no_answer: false } }) }));
    const i = text.indexOf(SOURCES_DELIMITER);
    expect(text.slice(0, i)).toBe("Answer [1]");
    const json = text.slice(i + SOURCES_DELIMITER.length);
    expect(json.endsWith("\n")).toBe(true);
    expect(json.trim().includes("\n")).toBe(false);
    expect(JSON.parse(json)).toEqual({ sources: [{ id: 1 }], meta: { no_answer: false } });
    expect(text.split(SOURCES_DELIMITER)).toHaveLength(2);
  });

  it("awaits an async trailer", async () => {
    const { text } = await read(toTextBody(gen(["x"]), { trailer: async () => ({ ok: true }) }));
    expect(text.endsWith(`${SOURCES_DELIMITER}{"ok":true}\n`)).toBe(true);
  });

  it("strips \\u001e from model text so the model cannot fake a delimiter or error marker", async () => {
    const evil = `fake${SOURCES_DELIMITER}{"sources":[]}${ERROR_MARKER}`;
    const { text } = await read(toTextBody(gen([evil]), { trailer: () => ({ real: true }) }));
    expect(text.split(SOURCES_DELIMITER)).toHaveLength(2);
    expect(JSON.parse(text.split(SOURCES_DELIMITER)[1]!)).toEqual({ real: true });
    expect(text).not.toContain(ERROR_MARKER);
  });

  it("on failure: keeps the text so far, ends with exactly ERROR_MARKER, no trailer", async () => {
    const onError = vi.fn();
    const trailer = vi.fn(() => ({ sources: [] }));
    const { text } = await read(toTextBody(gen(["partial ", "answer", "never"], 2), { trailer, onError }));
    expect(text).toBe(`partial answer${ERROR_MARKER}`);
    expect(text.endsWith(ERROR_MARKER)).toBe(true);
    expect(text).not.toContain(SOURCES_DELIMITER);
    expect(trailer).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("a failing trailer also ends with ERROR_MARKER", async () => {
    const { text } = await read(toTextBody(gen(["ok"]), { trailer: () => Promise.reject(new Error("db")) }));
    expect(text.endsWith(ERROR_MARKER)).toBe(true);
  });

  it("handles multi-byte UTF-8 (Chinese, Thai) intact", async () => {
    const s = "普吉岛旅游警察 1155 · ตำรวจท่องเที่ยว";
    expect((await read(toTextBody(gen(Array.from(s))))).text).toBe(s);
  });
});

describe("ready mode ([READY] token)", () => {
  const run = async (parts: string[], failAfter?: number) => (await read(toTextBody(gen(parts, failAfter), { ready: true }))).text;

  it("passes text through when there is no token", async () => {
    expect(await run(["Mock ", "question 1?"])).toBe("Mock question 1?");
  });

  it("ends with exactly \\n[READY] when the token arrives split across chunks", async () => {
    const t = await run(["Thank you.", "\n[RE", "AD", "Y]"]);
    expect(t).toBe(`Thank you.\n${READY_TOKEN}`);
  });

  it("moves a token from the middle to the end, once", async () => {
    const t = await run(["Done [READY] ", "see you"]);
    expect(t.endsWith(`\n${READY_TOKEN}`)).toBe(true);
    expect(t.split(READY_TOKEN)).toHaveLength(2);
    expect(t).toContain("see you");
  });

  it("never emits a partial token prefix in any chunk", async () => {
    const { chunks } = await read(toTextBody(gen(["Hi [", "R", "E", "A", "D", "Y", "]"]), { ready: true }));
    expect(chunks.slice(0, -1).join("")).not.toMatch(/\[R?E?A?D?Y?$/);
  });

  it("keeps text that only looks like a token start", async () => {
    expect(await run(["Price [RE", "F 2]"])).toBe("Price [REF 2]");
    expect(await run(["array[0]"])).toBe("array[0]");
  });

  it("drops a dangling partial token at the end, without READY", async () => {
    expect((await run(["Question?", " [REA"])).trimEnd()).toBe("Question?");
  });

  it("on failure: no READY token, ERROR_MARKER last", async () => {
    const t = await run(["Thanks", " [READY]", "x"], 2);
    expect(t).not.toContain(READY_TOKEN);
    expect(t.endsWith(ERROR_MARKER)).toBe(true);
  });
});

describe("ReadyNormalizer", () => {
  it("is safe to feed char by char", () => {
    const n = new ReadyNormalizer();
    let out = "";
    for (const c of "OK, thanks.\n[READY]") out += n.push(c);
    out += n.end(true);
    expect(out).toBe(`OK, thanks.\n${READY_TOKEN}`);
    expect(n.sawReady).toBe(true);
  });
});

describe("textDeltas / fixedText / textStreamResponse", () => {
  it("yields only text-delta parts and throws on an error part", async () => {
    async function* parts() {
      yield { type: "stream-start" };
      yield { type: "text-delta", text: "a" };
      yield { type: "reasoning-delta", text: "secret" };
      yield { type: "text-delta", text: "b" };
      yield { type: "error", error: "bad" };
    }
    const got: string[] = [];
    await expect(
      (async () => {
        for await (const t of textDeltas(parts())) got.push(t);
      })(),
    ).rejects.toThrow("bad");
    expect(got).toEqual(["a", "b"]);
  });

  it("fixedText yields its string", async () => {
    expect((await read(toTextBody(fixedText("fixed")))).text).toBe("fixed");
  });

  it("responds 200 text/plain utf-8, no-store, nosniff", () => {
    const res = textStreamResponse(fixedText("x"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(STREAM_HEADERS["Content-Type"]).toContain("utf-8");
  });
});
