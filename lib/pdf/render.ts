// Report PDF (contracts §3.4). Server-only; pdfkit is in serverExternalPackages.
//
// pdfkit's own line wrapper only breaks at spaces, and Thai has none between words, so this module wraps lines
// itself: text is split into runs by script (CJK → Noto Sans SC, everything else → Sarabun), segmented into words
// with Intl.Segmenter("th"), measured with the real font, and each line is placed with lineBreak: false.
// fontkit (inside pdfkit) shapes Thai marks; fonts are embedded as subsets.
// Fonts are read from lib/pdf/fonts at runtime (next.config.ts outputFileTracingIncludes ships them on Vercel).
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";

export type FontKey = "regular" | "bold" | "cjk";
export type Run = { text: string; bold?: boolean };
export type Piece = { text: string; font: FontKey };
export type Line = Piece[];
export type Measure = (text: string, font: FontKey) => number;

const FONT_FILES: Record<FontKey, string> = {
  regular: "Sarabun-Regular.ttf",
  bold: "Sarabun-Bold.ttf",
  cjk: "NotoSansSC-Regular.otf",
};

export function fontsDir(): string {
  return path.join(process.cwd(), "lib", "pdf", "fonts");
}

let fontCache: Record<FontKey, Buffer> | undefined;
function loadFonts(): Record<FontKey, Buffer> {
  fontCache ??= {
    regular: fs.readFileSync(path.join(fontsDir(), FONT_FILES.regular)),
    bold: fs.readFileSync(path.join(fontsDir(), FONT_FILES.bold)),
    cjk: fs.readFileSync(path.join(fontsDir(), FONT_FILES.cjk)),
  };
  return fontCache;
}

/** Fixed footer on every page (Thai + English). The only number in it is the Tourist Police hotline. */
export const PDF_FOOTER_TH =
  "เอกสารนี้จัดทำโดยนักท่องเที่ยวด้วยความช่วยเหลือของ SabaiSafe มิใช่บันทึกการแจ้งความอย่างเป็นทางการ · ตำรวจท่องเที่ยว 1155";
export const PDF_FOOTER_EN =
  "Prepared by the tourist with SabaiSafe. This is not an official police report. Tourist Police: 1155.";

// ------------------------------------------------------------------ markdown → blocks

export type Block =
  | { kind: "h1" | "h2" | "p"; runs: Run[] }
  | { kind: "li"; bullet: string; runs: Run[] }
  | { kind: "hr" };

/** Inline Markdown → runs: **bold** kept, other markers (*, _, `, links, escapes) reduced to plain text. */
export function parseInline(text: string): Run[] {
  const plain = (s: string) =>
    s
      .replace(/!?\[([^\]]*)\]\(([^)\s]+)\)/g, (_, t: string, u: string) => (t && t !== u ? `${t} (${u})` : u))
      .replace(/`([^`]*)`/g, "$1")
      .replace(/(^|[^\p{L}\p{N}])[*_]([^*_\n]+)[*_](?=$|[^\p{L}\p{N}])/gu, "$1$2")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, "$1");
  const runs: Run[] = [];
  const re = /\*\*([^*]+?)\*\*|__([^_]+?)__/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) runs.push({ text: plain(text.slice(last, m.index)) });
    runs.push({ text: plain(m[1] ?? m[2] ?? ""), bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: plain(text.slice(last)) });
  return runs.filter((r) => r.text !== "");
}

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", runs: parseInline(para.join(" ")) });
    para = [];
  };
  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    let m: RegExpExecArray | null;
    if (line === "" || /^```/.test(line)) {
      flush();
    } else if ((m = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line))) {
      flush();
      blocks.push({ kind: m[1]!.length === 1 ? "h1" : "h2", runs: parseInline(m[2]!) });
    } else if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flush();
      blocks.push({ kind: "hr" });
    } else if ((m = /^(?:[-*+]|(\d+)[.)])\s+(.*)$/.exec(line))) {
      flush();
      blocks.push({ kind: "li", bullet: m[1] ? `${m[1]}.` : "•", runs: parseInline(m[2]!) });
    } else {
      para.push(line.replace(/^>\s?/, ""));
    }
  }
  flush();
  return blocks;
}

// ------------------------------------------------------------------ wrapping

const CJK = /[⺀-⿿　-〿぀-ヿ㄀-ㄯ㆐-ㇿ㐀-䶿一-鿿豈-﫿︰-﹏＀-￯]/u;

/** Splits a run into pieces by script so each piece uses a font that has its glyphs. */
export function splitByScript(run: Run): Piece[] {
  const base: FontKey = run.bold ? "bold" : "regular";
  const out: Piece[] = [];
  for (const ch of run.text) {
    const font: FontKey = CJK.test(ch) ? "cjk" : base;
    const prev = out[out.length - 1];
    if (prev && prev.font === font) prev.text += ch;
    else out.push({ text: ch, font });
  }
  return out;
}

const wordSeg = new Intl.Segmenter("th", { granularity: "word" });
const graphemeSeg = new Intl.Segmenter("th", { granularity: "grapheme" });

/** Word-level tokens (Thai, Chinese and Latin aware). Whitespace tokens are kept, flagged by content. */
function tokens(runs: Run[]): Piece[] {
  const out: Piece[] = [];
  for (const run of runs) {
    for (const piece of splitByScript({ ...run, text: run.text.replace(/\s+/g, " ") })) {
      for (const s of wordSeg.segment(piece.text)) out.push({ text: s.segment, font: piece.font });
    }
  }
  return out;
}

function mergeLine(line: Piece[]): Line {
  while (line.length && line[line.length - 1]!.text.trim() === "") line.pop();
  const out: Piece[] = [];
  for (const p of line) {
    const prev = out[out.length - 1];
    if (prev && prev.font === p.font) prev.text += p.text;
    else out.push({ ...p });
  }
  return out;
}

/**
 * Greedy line wrapping at word boundaries. A word wider than the line is broken between graphemes (so Thai
 * vowels and tone marks stay on their base character). Pure: `measure` gives a piece's width.
 */
export function wrapRuns(runs: Run[], maxWidth: number, measure: Measure): Line[] {
  const lines: Line[] = [];
  let cur: Piece[] = [];
  let width = 0;
  const newLine = () => {
    const merged = mergeLine(cur);
    if (merged.length) lines.push(merged);
    cur = [];
    width = 0;
  };
  for (const tok of tokens(runs)) {
    const isSpace = tok.text.trim() === "";
    if (isSpace && cur.length === 0) continue;
    const w = measure(tok.text, tok.font);
    if (width + w <= maxWidth) {
      cur.push(tok);
      width += w;
      continue;
    }
    if (isSpace) {
      newLine();
      continue;
    }
    if (cur.length) newLine();
    if (w <= maxWidth) {
      cur.push(tok);
      width = w;
      continue;
    }
    for (const g of graphemeSeg.segment(tok.text)) {
      const gw = measure(g.segment, tok.font);
      if (width + gw > maxWidth && cur.length) newLine();
      cur.push({ text: g.segment, font: tok.font });
      width += gw;
    }
  }
  newLine();
  return lines;
}

// ------------------------------------------------------------------ rendering

const MARGIN = 56;
const FOOTER_SIZE = 8;
const FOOTER_HEIGHT = 34;
const STYLE = {
  h1: { size: 17, before: 6, after: 6 },
  h2: { size: 14, before: 12, after: 6 },
  p: { size: 11, before: 0, after: 7 },
  li: { size: 11, before: 0, after: 3 },
} as const;
const LINE_FACTOR = 1.55; // Thai needs room above and below for vowels and tone marks.

/**
 * SARA AM (U+0E33) as its compatibility decomposition NIKHAHIT + SARA AA. fontkit draws the same glyphs either way,
 * but the precomposed form makes the PDF's text layer extract as "ำา"; decomposed, it extracts NFKC-equal to the input.
 * The characters below are literal: pattern = U+0E33 SARA AM; replacement = U+0E4D NIKHAHIT + U+0E32 SARA AA.
 */
export const pdfText = (s: string) => s.replace(/ำ/g, "ํา");

/** Bangkok date as YYYYMMDD (for the file name). */
export function bangkokDateStamp(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(now)
    .replace(/-/g, "");
}

/** Renders the report Markdown (Thai + English summary) to an A4 PDF. */
export async function renderReportPdf(markdown: string): Promise<Buffer> {
  const fonts = loadFonts();
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true,
    // Setting a font here means pdfkit never loads its built-in Helvetica metrics from disk.
    font: path.join(fontsDir(), FONT_FILES.regular),
    info: { Title: "SabaiSafe incident summary", Creator: "SabaiSafe", Producer: "SabaiSafe" },
    lang: "th",
  });
  for (const k of Object.keys(FONT_FILES) as FontKey[]) doc.registerFont(k, fonts[k]);

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = MARGIN;
  const contentWidth = doc.page.width - 2 * MARGIN;
  const bottom = () => doc.page.height - MARGIN - FOOTER_HEIGHT;
  let y = MARGIN;
  let size = 11;
  const measure: Measure = (text, font) => doc.font(font).fontSize(size).widthOfString(pdfText(text));

  const drawLine = (line: Line, x: number, lineHeight: number) => {
    if (y + lineHeight > bottom()) {
      doc.addPage();
      y = MARGIN;
    }
    let cx = x;
    for (const p of line) {
      doc.font(p.font).fontSize(size).fillColor("#111111").text(pdfText(p.text), cx, y, { lineBreak: false });
      cx += measure(p.text, p.font);
    }
    y += lineHeight;
  };

  for (const block of parseMarkdown(markdown)) {
    if (block.kind === "hr") {
      y += 4;
      doc.moveTo(left, y).lineTo(left + contentWidth, y).lineWidth(0.5).strokeColor("#999999").stroke();
      y += 8;
      continue;
    }
    const style = STYLE[block.kind];
    size = style.size;
    const lh = size * LINE_FACTOR;
    if (y > MARGIN) y += style.before;
    const runs = block.kind === "h1" || block.kind === "h2" ? block.runs.map((r) => ({ ...r, bold: true })) : block.runs;
    if (block.kind === "li") {
      const indent = 16;
      const lines = wrapRuns(runs, contentWidth - indent, measure);
      lines.forEach((line, i) => {
        if (i === 0) {
          if (y + lh > bottom()) {
            doc.addPage();
            y = MARGIN;
          }
          doc.font("regular").fontSize(size).text(block.bullet, left, y, { lineBreak: false });
        }
        drawLine(line, left + indent, lh);
      });
    } else {
      for (const line of wrapRuns(runs, contentWidth, measure)) drawLine(line, left, lh);
    }
    y += style.after;
  }

  // Footer on every page, inside the bottom margin area reserved above.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    size = FOOTER_SIZE;
    const fy = doc.page.height - MARGIN - FOOTER_HEIGHT + 8;
    doc.moveTo(left, fy - 4).lineTo(left + contentWidth, fy - 4).lineWidth(0.5).strokeColor("#bbbbbb").stroke();
    let ly = fy;
    for (const text of [PDF_FOOTER_TH, `${PDF_FOOTER_EN}  (${i + 1}/${range.count})`]) {
      for (const line of wrapRuns([{ text }], contentWidth, measure)) {
        let cx = left;
        for (const p of line) {
          doc.font(p.font).fontSize(size).fillColor("#555555").text(pdfText(p.text), cx, ly, { lineBreak: false });
          cx += measure(p.text, p.font);
        }
        ly += size * 1.4;
      }
    }
  }
  doc.end();
  return done;
}
