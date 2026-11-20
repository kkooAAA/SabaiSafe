/** Minimal RFC 4180 CSV parser for tests (quotes, escaped quotes, CRLF). Independent of backend's loader on purpose. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Rows keyed by the expected columns `K`; missing cells become "", extra cells are reported in `width`. */
export function csvObjects<K extends string>(
  text: string,
  columns: readonly K[],
): { header: string[]; rows: { line: number; width: number; data: Record<K, string> }[] } {
  const [header = [], ...body] = parseCsv(text);
  return {
    header,
    rows: body.map((r, i) => ({
      line: i + 2,
      width: r.length,
      data: Object.fromEntries(columns.map((c) => [c, r[header.indexOf(c)] ?? ""])) as Record<K, string>,
    })),
  };
}
