// Minimal RFC 4180 CSV parser (no dependency). Owner: backend.
// Handles quoted fields with commas, doubled quotes and newlines; LF or CRLF; a trailing newline.
// Each record carries the 1-based line number where it starts, for error messages.

export type CsvRecord = { line: number; fields: string[] };

export class CsvSyntaxError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(message);
    this.name = "CsvSyntaxError";
  }
}

export function parseCsv(input: string): CsvRecord[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let fieldStarted = false; // distinguishes an empty trailing line from a record with one empty field

  const endRecord = () => {
    fields.push(field);
    // Skip completely blank lines (e.g. the final newline).
    if (!(fields.length === 1 && fields[0] === "" && !fieldStarted)) records.push({ line: recordLine, fields });
    fields = [];
    field = "";
    fieldStarted = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (c === "\n") line++;
        field += c;
      }
      continue;
    }
    if (c === '"') {
      if (field !== "") throw new CsvSyntaxError(line, 'quote inside an unquoted field (quote the whole field and double any ")');
      inQuotes = true;
      fieldStarted = true;
    } else if (c === ",") {
      fields.push(field);
      field = "";
      fieldStarted = true;
    } else if (c === "\r" && text[i + 1] === "\n") {
      // CRLF: handled by the \n branch on the next iteration.
    } else if (c === "\n") {
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += c;
      fieldStarted = true;
    }
  }
  if (inQuotes) throw new CsvSyntaxError(recordLine, "unterminated quoted field");
  if (field !== "" || fields.length > 0 || fieldStarted) endRecord();
  return records;
}
