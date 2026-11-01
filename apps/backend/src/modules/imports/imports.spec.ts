import { readFileSync } from 'fs';
import { join } from 'path';
import { parseCsv } from './csv';
import { validateIngredients } from './ingredient-import';
import { validateMenu } from './menu-import';
import { templateCsv } from './templates';

const menu = (csv: string) => validateMenu(parseCsv(csv));
const ing = (csv: string) => validateIngredients(parseCsv(csv));

describe('shipped example files', () => {
  it('the menu example imports with no errors, and the docs copy matches the download', () => {
    const v = menu(templateCsv('menu', true));
    expect(v.errors).toEqual([]);
    expect(v.fatal).toBeUndefined();
    expect(v.unknownColumns).toEqual([]);
    expect(v.rows).toHaveLength(7);
    const onDisk = readFileSync(
      join(__dirname, '../../../../../docs/examples/menu-items.csv'),
      'utf8',
    );
    expect(onDisk).toBe(templateCsv('menu', true));
  });

  it('the ingredient example imports with no errors, and the docs copy matches the download', () => {
    const v = ing(templateCsv('ingredients', true));
    expect(v.errors).toEqual([]);
    expect(v.rows).toHaveLength(9);
    const onDisk = readFileSync(
      join(__dirname, '../../../../../docs/examples/ingredients.csv'),
      'utf8',
    );
    expect(onDisk).toBe(templateCsv('ingredients', true));
  });

  it('the blank templates have headers only and are accepted as "no rows"', () => {
    expect(menu(templateCsv('menu', false)).fatal).toMatch(/no items/);
    expect(ing(templateCsv('ingredients', false)).fatal).toMatch(
      /no ingredients/,
    );
  });
});

describe('validateMenu', () => {
  const H = 'name,category,price\n';

  it('requires name, category and price columns', () => {
    expect(menu('name,price\nTea,20').fatal).toMatch(/category/);
    expect(menu('foo,bar\n1,2').fatal).toMatch(/name, category, price/);
  });

  it('accepts friendly header spellings and ignores unknown columns', () => {
    const v = menu(
      'Item Name,Category,Selling Price,GST %,Notes\nTea,Drinks,20,5,hot',
    );
    expect(v.errors).toEqual([]);
    expect(v.rows[0]).toMatchObject({
      name: 'Tea',
      category: 'Drinks',
      price: 20,
      taxRatePercent: 5,
    });
    expect(v.unknownColumns).toEqual(['Notes']);
  });

  it('reports every problem in a row, with its line number', () => {
    const v = menu(H + 'Tea,Drinks,abc\n,Drinks,10\nCoffee,,5\nOK,Drinks,10');
    expect(v.rows.map((r) => r.name)).toEqual(['OK']);
    expect(v.errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(v.errors[0].messages[0]).toMatch(/Price "abc" is not a number/);
    expect(v.errors[1].messages).toContain('Name is required');
    expect(v.errors[2].messages).toContain('Category is required');
  });

  it('parses numbers the way restaurants write them', () => {
    const v = menu(H + 'A,C,"₹1,200.50"\nB,C,Rs. 90\nC,C,"12,5"');
    expect(v.rows.map((r) => r.price)).toEqual([1200.5, 90]);
    expect(v.errors[0].messages[0]).toMatch(/decimal comma/);
  });

  it('checks ranges and combinations', () => {
    const v = menu(
      'name,category,price,half_price,tax_rate_percent,available_from\nA,C,100,150,5,\nB,C,100,,150,\nC,C,100,,5,25:00\nD,C,100,,5,09:00',
    );
    expect(v.errors[0].messages).toContain(
      'Half price is higher than the full price',
    );
    expect(v.errors[1].messages[0]).toMatch(/Tax rate cannot be above 100/);
    expect(v.errors[2].messages.join()).toMatch(/09:30|24-hour/);
    expect(v.errors[3].messages).toContain(
      'Set both Available from and Available to, or neither',
    );
  });

  it('catches an unquoted comma that would shift every later column', () => {
    const v = menu(
      'name,category,price\nDal, Tadka,Main Course,200\nOK,Main,10',
    );
    expect(v.rows.map((r) => r.name)).toEqual(['OK']);
    expect(v.errors[0].messages.join(' ')).toMatch(/wrapped in "quotes"/);
  });

  it('reads veg / spice / active in common spellings', () => {
    const v = menu(
      'name,category,price,is_veg,spice_level,is_active\nA,C,1,Non-Veg,very hot,No\nB,C,1,Y,Medium,TRUE',
    );
    expect(v.rows[0]).toMatchObject({
      isVeg: false,
      spiceLevel: 'EXTRA_HOT',
      isActive: false,
    });
    expect(v.rows[1]).toMatchObject({
      isVeg: true,
      spiceLevel: 'MEDIUM',
      isActive: true,
    });
    expect(
      menu('name,category,price,is_veg\nA,C,1,maybe').errors[0].messages[0],
    ).toMatch(/yes or no/);
    expect(
      menu('name,category,price,spice_level\nA,C,1,fiery').errors[0]
        .messages[0],
    ).toMatch(/not one of/);
  });

  it('splits allergens on ; or | and removes repeats', () => {
    expect(
      menu('name,category,price,allergens\nA,C,1,nuts; dairy|nuts').rows[0]
        .allergens,
    ).toEqual(['nuts', 'dairy']);
  });

  it('refuses spreadsheet formulas in text fields', () => {
    const v = menu(H + '=HYPERLINK("http://x"),C,1\nOk,+cmd,1');
    expect(v.errors).toHaveLength(2);
    expect(v.errors[0].messages[0]).toMatch(/formula/);
  });

  it('flags duplicates inside the file by SKU, or by name + category', () => {
    const a = menu('name,category,price,sku\nA,C,1,X1\nB,C,1,x1\nC,C,1,');
    expect(a.errors[0]).toMatchObject({ line: 3 });
    expect(a.errors[0].messages[0]).toMatch(/Duplicate of line 2.*SKU/);
    const b = menu(H + 'Tea,Drinks,1\ntea,DRINKS,2\nTea,Snacks,3');
    expect(b.errors).toHaveLength(1);
    expect(b.rows).toHaveLength(2); // same name in another category is a different item
  });

  it('caps the number of rows', () => {
    const big =
      H + Array.from({ length: 2001 }, (_, i) => `I${i},C,1`).join('\n');
    expect(menu(big).fatal).toMatch(/limit is 2000/);
  });

  it('blank optional cells stay undefined (so updates leave the old value alone)', () => {
    const r = menu('name,category,price,half_price,sku\nA,C,10,,').rows[0];
    expect(r.halfPrice).toBeUndefined();
    expect(r.sku).toBeUndefined();
  });
});

describe('validateIngredients', () => {
  it('normalises units from everyday spellings', () => {
    const v = ing(
      'name,unit\nA,kg\nB,Gms\nC,ltr\nD,pcs\nE,Dozen\nF,Packet\nG,ML\nH,Box',
    );
    expect(v.errors).toEqual([]);
    expect(v.rows.map((r) => r.unit)).toEqual([
      'KG',
      'G',
      'L',
      'PIECE',
      'DOZEN',
      'PACK',
      'ML',
      'BOX',
    ]);
  });

  it('rejects unknown units and negative numbers', () => {
    const v = ing(
      'name,unit,reorder_level,opening_stock\nA,bucket,1,1\nB,KG,-1,1\nC,KG,1,-5',
    );
    expect(v.errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(v.errors[0].messages[0]).toMatch(/Unit "bucket" is not one of/);
  });

  it('accepts the friendly header names and flags duplicates', () => {
    const v = ing(
      'Ingredient,UOM,Min Stock,Cost,Qty\nRice,kg,10,90,50\nrice,kg,1,1,1',
    );
    expect(v.rows[0]).toMatchObject({
      name: 'Rice',
      unit: 'KG',
      reorderLevel: 10,
      costPerUnit: 90,
      openingStock: 50,
    });
    expect(v.errors[0].messages[0]).toMatch(/Duplicate of line 2/);
  });

  it('requires name and unit columns', () => {
    expect(ing('name,qty\nA,1').fatal).toMatch(/unit/);
  });
});
