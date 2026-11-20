// Extracts the text of a PDF with pdfjs-dist (legacy Node build, no worker). Tests only.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function pdfText(bytes: Uint8Array): Promise<{ pages: number; text: string }> {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    parts.push(content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join(""));
  }
  const pages = doc.numPages;
  await task.destroy();
  return { pages, text: parts.join("\n").normalize("NFC") };
}

/**
 * Whitespace-insensitive form, for comparing wrapped text. NFKC because pdfjs extracts Thai SARA AM (U+0E33) as its
 * compatibility decomposition NIKHAHIT + SARA AA (U+0E4D U+0E32); viewers render both identically.
 */
export const squash = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");
