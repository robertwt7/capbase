import { describe, it, expect } from '@jest/globals';

import { createCsvParser, parseCsv, type CsvRow } from './csv';

/** Feed `text` to the streaming parser in chunks of exactly `size` characters,
 *  so a boundary lands wherever the caller wants one. */
function streamInChunks(text: string, size: number): CsvRow[] {
  const rows: CsvRow[] = [];
  const parser = createCsvParser((row) => rows.push(row));
  for (let i = 0; i < text.length; i += size) parser.write(text.slice(i, i + size));
  parser.end();
  return rows;
}

const SAMPLE =
  'Company,"Award Title","Award Amount"\r\n' +
  '"Verinomics, Inc.","Developing a\nsterile platform",664827.0000\r\n' +
  '"AERODYNE RESEARCH INC","He said ""no"" twice",608556.0000\r\n';

const EXPECTED: CsvRow[] = [
  {
    Company: 'Verinomics, Inc.',
    'Award Title': 'Developing a\nsterile platform',
    'Award Amount': '664827.0000',
  },
  {
    Company: 'AERODYNE RESEARCH INC',
    'Award Title': 'He said "no" twice',
    'Award Amount': '608556.0000',
  },
];

describe('createCsvParser', () => {
  it('emits the same rows whatever the chunk boundaries are', () => {
    // Every size from 1 puts a boundary mid-field, mid-quote, between an
    // escaped `""` pair, and between the CR and LF of a CRLF at some point.
    for (let size = 1; size <= SAMPLE.length; size++) {
      expect(streamInChunks(SAMPLE, size)).toEqual(EXPECTED);
    }
  });

  it('keeps a record that spans several physical lines intact', () => {
    // 55 records in the SBIR award file do this, which is why a line split is
    // wrong for that file.
    const rows = streamInChunks(SAMPLE, 7);
    expect(rows[0]!['Award Title']).toContain('\n');
    expect(rows).toHaveLength(2);
  });

  it('flushes a final record with no trailing newline', () => {
    const rows = streamInChunks('a,b\n1,2', 3);
    expect(rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('closes a quoted field that runs to end of file', () => {
    const rows = streamInChunks('a,b\n1,"unterminated', 4);
    expect(rows).toEqual([{ a: '1', b: 'unterminated' }]);
  });

  it('ignores blank lines between records', () => {
    expect(streamInChunks('a,b\r\n1,2\r\n\r\n3,4\r\n', 5)).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('emits nothing for a header-only file', () => {
    expect(streamInChunks('a,b\n', 2)).toEqual([]);
    expect(streamInChunks('', 2)).toEqual([]);
  });

  it('strips a UTF-8 BOM from the first chunk only', () => {
    expect(streamInChunks('﻿a,b\n1,2\n', 1)).toEqual([{ a: '1', b: '2' }]);
  });
});

describe('parseCsv', () => {
  it('is the buffered form of the same parser', () => {
    expect(parseCsv(SAMPLE)).toEqual(EXPECTED);
  });
});
