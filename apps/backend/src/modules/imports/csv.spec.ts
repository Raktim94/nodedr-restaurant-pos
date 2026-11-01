import { CsvError, looksLikeFormula, parseCsv, toCsv } from './csv';

describe('parseCsv', () => {
  it('reads a plain file and numbers the lines', () => {
    const p = parseCsv('name,price\nTea,20\nCoffee,30\n');
    expect(p.headers).toEqual(['name', 'price']);
    expect(p.rows).toEqual([
      { line: 2, cells: ['Tea', '20'], overflow: false, longer: false },
      { line: 3, cells: ['Coffee', '30'], overflow: false, longer: false },
    ]);
  });

  it('handles a BOM, CRLF and old-Mac CR line ends', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n').rows[0].cells).toEqual(['1', '2']);
    expect(parseCsv('a,b\r1,2\r3,4').rows).toHaveLength(2);
  });

  it('handles quoted commas, doubled quotes and embedded newlines', () => {
    const p = parseCsv(
      'name,notes\n"Dal, Tadka","He said ""hot"""\n"Two\nlines",x\n',
    );
    expect(p.rows[0].cells).toEqual(['Dal, Tadka', 'He said "hot"']);
    expect(p.rows[1].cells).toEqual(['Two\nlines', 'x']);
    // Line numbers still point at where each record starts in the file.
    expect(p.rows.map((r) => r.line)).toEqual([2, 3]);
  });

  it('detects semicolon and tab delimiters (Excel in other locales)', () => {
    expect(parseCsv('a;b\n1;2').delimiter).toBe(';');
    expect(parseCsv('a;b\n1;2').rows[0].cells).toEqual(['1', '2']);
    expect(parseCsv('a\tb\n1\t2').delimiter).toBe('\t');
    // A comma inside quotes does not make a semicolon file a comma file.
    expect(parseCsv('a;b\n"1,5";2').rows[0].cells).toEqual(['1,5', '2']);
  });

  it('skips blank lines, pads short rows and trims unquoted cells', () => {
    const p = parseCsv('a,b,c\n\n 1 , 2\n\n');
    expect(p.rows).toEqual([
      { line: 3, cells: ['1', '2', ''], overflow: false, longer: false },
    ]);
  });

  it('reports a row with more values than columns instead of dropping them', () => {
    const p = parseCsv('name,category\nDal, Tadka,Main\nTea,Drinks,,\n');
    expect(p.rows[0].overflow).toBe(true);
    expect(p.rows[1].overflow).toBe(false); // trailing empty cells are harmless
  });

  it('keeps spaces inside quotes', () => {
    expect(parseCsv('a\n" x "').rows[0].cells).toEqual([' x ']);
  });

  it('refuses what it cannot read safely', () => {
    expect(() => parseCsv('')).toThrow(CsvError);
    expect(() => parseCsv('\n\n')).toThrow(CsvError);
    expect(() => parseCsv('a,b\n"open,1')).toThrow(/never closed/);
    expect(() => parseCsv('PK\u0000\u0003binary')).toThrow(/text CSV/);
  });
});

describe('toCsv', () => {
  it('quotes only when needed and round-trips through the parser', () => {
    const out = toCsv([
      ['name', 'note'],
      ['Dal, Tadka', 'say "hi"'],
      ['Plain', ''],
    ]);
    expect(out).toBe('name,note\r\n"Dal, Tadka","say ""hi"""\r\nPlain,\r\n');
    expect(parseCsv(out).rows[0].cells).toEqual(['Dal, Tadka', 'say "hi"']);
  });
});

describe('looksLikeFormula', () => {
  it('flags spreadsheet formulas but not ordinary values', () => {
    for (const v of ['=SUM(A1)', '+1+1', '@cmd', '-cmd|x', '\tx']) {
      expect(looksLikeFormula(v)).toBe(true);
    }
    for (const v of ['Paneer Tikka', '-5', '-0.5', '12.5', '100% juice', '']) {
      expect(looksLikeFormula(v)).toBe(false);
    }
  });
});
