// RFC 4180 CSV reading, shared by every source whose publisher ships a real CSV
// rather than a line-splittable table. Two entry points: `parseCsv` for a file
// small enough to hold as a string, and `createCsvParser` for one that is not.

export type CsvRow = Record<string, string>;

/**
 * Minimal RFC 4180 CSV reader.
 *
 * The SEC roster files need a real parser, not a line split: money columns
 * contain commas ("484,007,760.00") and two header cells contain embedded
 * newlines ("Total number of offices\n other than your Principal Office…"),
 * which would silently shift every subsequent column.
 */
export function parseCsv(text: string): CsvRow[] {
  const out: CsvRow[] = [];
  const parser = createCsvParser((row) => out.push(row));
  parser.write(text);
  parser.end();
  return out;
}

export interface CsvParser {
  /** Feed a chunk. Boundaries may fall anywhere, including mid-field,
   *  mid-quote and between the CR and LF of a CRLF. */
  write(chunk: string): void;
  /** Flush the final record (a file need not end with a newline). */
  end(): void;
}

/**
 * Feed-and-emit RFC 4180 parser for files too large to hold as a string.
 *
 * The SBIR award file is ~91 MB and 55 of its records span more than one
 * physical line, so neither a line split nor a full buffer is an option — the
 * worker's memory limit is 1536m and the row objects alone would not fit.
 * Aggregating as rows arrive keeps peak memory in the low hundreds of MB.
 */
export function createCsvParser(onRow: (row: CsvRow) => void): CsvParser {
  let keys: string[] | null = null;
  let row: string[] = [];
  let field = '';
  let quoted = false;
  /** True when the previous chunk ended on a `"` inside a quoted field: it is
   *  either the closing quote or the first half of an escaped `""`, and only
   *  the next character says which. */
  let pendingQuote = false;
  /** True when the previous chunk ended on a CR, whose LF may open the next. */
  let pendingCr = false;
  let started = false;

  const endField = (): void => {
    row.push(field);
    field = '';
  };

  const endRow = (): void => {
    endField();
    // Ignore blank lines between records.
    if (row.length > 1 || row[0] !== '') {
      if (keys === null) keys = row.map((h) => h.trim());
      else {
        const out: CsvRow = {};
        for (const [i, key] of keys.entries()) out[key] = (row[i] ?? '').trim();
        onRow(out);
      }
    }
    row = [];
  };

  const feed = (src: string): void => {
    for (let i = 0; i < src.length; i++) {
      const ch = src[i]!;

      if (pendingQuote) {
        pendingQuote = false;
        if (ch === '"') {
          field += '"';
          continue;
        }
        quoted = false;
        // Fall through: this character is outside the quotes.
      }

      if (pendingCr) {
        pendingCr = false;
        // A CRLF is one break; the CR already ended the row.
        if (ch === '\n') continue;
      }

      if (quoted) {
        if (ch === '"') pendingQuote = true;
        else field += ch;
        continue;
      }

      if (ch === '"') quoted = true;
      else if (ch === ',') endField();
      else if (ch === '\n') endRow();
      else if (ch === '\r') {
        endRow();
        pendingCr = true;
      } else field += ch;
    }
  };

  return {
    write(chunk: string): void {
      if (!chunk) return;
      // Strip a UTF-8 BOM if one slipped through, once, on the first chunk.
      feed(!started && chunk.charCodeAt(0) === 0xfeff ? chunk.slice(1) : chunk);
      started = true;
    },
    end(): void {
      // A trailing `"` closes its field; nothing follows it to disambiguate.
      pendingQuote = false;
      quoted = false;
      endRow();
    },
  };
}
