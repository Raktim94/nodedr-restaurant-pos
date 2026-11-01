// A small, strict CSV reader (RFC 4180) for the bulk imports.
//
// It accepts what spreadsheets really produce: a UTF-8 BOM, CRLF or LF line
// ends, quoted cells with embedded commas / quotes / newlines, and a comma,
// semicolon or tab delimiter (Excel in many locales saves with semicolons).
// It rejects what it cannot read safely (an unterminated quote) instead of
// guessing, so a broken file fails loudly rather than importing garbage.

export class CsvError extends Error {}

export interface ParsedCsv {
  delimiter: ',' | ';' | '\t';
  /** Header cells, trimmed, as written. */
  headers: string[];
  /** Data rows; `line` is the 1-based line number in the file, for error messages. */
  rows: {
    line: number;
    cells: string[];
    /** Non-empty values beyond the header columns (usually an unquoted comma). */
    overflow: boolean;
    /** Any cell beyond the header width, even an empty one. */
    longer: boolean;
  }[];
}

function detectDelimiter(firstLine: string): ',' | ';' | '\t' {
  // Only count delimiters outside quotes.
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) return ';';
  if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) return '\t';
  return ',';
}

export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^\uFEFF/, '');
  if (text.includes('\u0000')) {
    throw new CsvError('This does not look like a text CSV file');
  }
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? '';
  const delimiter = detectDelimiter(firstLine);

  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  let wasQuoted = false; // the current cell started with a quote

  const endCell = () => {
    cells.push(wasQuoted ? cell : cell.trim());
    cell = '';
    wasQuoted = false;
  };
  const endRecord = () => {
    endCell();
    // Skip lines that are entirely empty.
    if (!(cells.length === 1 && cells[0] === '')) {
      records.push({ line: recordLine, cells });
    }
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.trim() === '') {
      quoted = true;
      wasQuoted = true;
      cell = '';
    } else if (ch === delimiter) {
      endCell();
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      cell += ch;
    }
  }
  if (quoted) {
    throw new CsvError(
      `A quoted value that starts on line ${recordLine} is never closed`,
    );
  }
  if (cell !== '' || cells.length > 0) endRecord();

  if (records.length === 0) throw new CsvError('The file is empty');
  const [head, ...body] = records;
  const headers = head.cells.map((h) => h.trim());
  if (headers.every((h) => h === '')) {
    throw new CsvError('The first line must be the column names');
  }
  return {
    delimiter,
    headers,
    rows: body.map((r) => ({
      line: r.line,
      // Pad to the header width so a short row reads as blanks. Extra cells are
      // not silently dropped: they are reported so the row can be fixed.
      cells: headers.map((_, i) => r.cells[i] ?? ''),
      overflow: r.cells.slice(headers.length).some((c) => c !== ''),
      longer: r.cells.length > headers.length,
    })),
  };
}

/** Quotes a value for CSV output. */
export function csvCell(
  value: string | number | boolean | null | undefined,
): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n;]/.test(s) || s !== s.trim()
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

export function toCsv(
  rows: (string | number | boolean | null | undefined)[][],
): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/**
 * A cell that a spreadsheet would execute as a formula. Imported names end up
 * in exports and printouts that people open in Excel, so these are refused.
 */
export function looksLikeFormula(value: string): boolean {
  return /^[=+@\t\r]/.test(value) || /^-[^\d.\s]/.test(value);
}
