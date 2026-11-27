import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_LOCALE, LOCALES } from "./i18n/locales.ts";

const staffLocales = LOCALES.filter((locale) => locale !== DEFAULT_LOCALE);

function catalog(locale: string): Record<string, string> {
  const url = new URL(`./i18n/staff/${locale}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8"));
}

test("the staff language choices cover the same UI messages and keep their named values", () => {
  const portuguese = catalog("pt");
  for (const locale of staffLocales) {
    const messages = catalog(locale);
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(portuguese).sort(), locale);
    for (const [source, translated] of Object.entries(messages)) {
      const parameters = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();
      assert.ok(translated.trim(), locale + ": " + source);
      assert.deepEqual(parameters(translated), parameters(source), locale + ": " + source);
    }
    for (const source of ["No customers yet", "Roles & permissions", "Today's Orders"]) {
      assert.ok(messages[source] && messages[source] !== source, locale + ": " + source);
    }
  }
});

test("Italian covers every public, kiosk and regional setup message and preserves its values", () => {
  const read = (locale: string): Record<string, string> =>
    JSON.parse(readFileSync(new URL(`./i18n/dictionaries/${locale}.json`, import.meta.url), "utf8"));
  const english = read("en");
  const italian = read("it");
  assert.deepEqual(Object.keys(italian).sort(), Object.keys(english).sort());
  for (const [key, source] of Object.entries(english)) {
    assert.ok(italian[key].trim(), key);
    assert.deepEqual(italian[key].match(/\{\w+\}/g)?.sort() ?? [], source.match(/\{\w+\}/g)?.sort() ?? [], key);
  }
});

test("a substituted name is literal even if it contains another placeholder or dollar syntax", async () => {
  const { formatMessage } = await import("./i18n/message.ts");
  assert.equal(formatMessage("{name} / {count} / {name}", { name: "A$&{count}", count: 2 }),
    "A$&{count} / 2 / A$&{count}");
  assert.equal(formatMessage("Hello {name}", {}), "Hello {name}");
});

test("staff routes use the language picker for visible copy and all literal messages have translations", async () => {
  const { readdirSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const ts = (await import("typescript")).default;
  const root = new URL("../", import.meta.url);
  const base = JSON.parse(readFileSync(new URL("lib/i18n/dictionaries/en.json", root), "utf8"));
  const catalogs = staffLocales.map(catalog);
  const missing = new Set<string>();
  const untranslated: string[] = [];
  for (const dir of ["app/(dashboard)/", "components/", "hooks/"]) {
    const staffRoute = dir === "app/(dashboard)/";
    const directory = new URL(dir, root);
    for (const path of readdirSync(directory, { recursive: true, encoding: "utf8" })) {
      if (!/\.tsx?$/.test(path)) continue;
      const filename = fileURLToPath(new URL(path, directory));
      const text = readFileSync(filename, "utf8");
      if (!staffRoute && !text.includes("useI18n") && !text.includes("Translate")) continue;
      const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
      const inspect = (node: import("typescript").Node) => {
        if (staffRoute && ts.isJsxText(node) && /[a-z]{2}/i.test(node.text)) {
          const element = node.parent;
          const tag = ts.isJsxElement(element) ? element.openingElement.tagName.getText(source) : "";
          const linkAddress = tag === "a" && /^(?:https?:\/\/)?[\w.-]+\.[a-z]+\//i.test(node.text.trim());
          if (tag !== "code" && tag !== "kbd" && !linkAddress) {
            untranslated.push(path + ": " + node.text.trim());
          }
        }
        if (staffRoute && ts.isJsxAttribute(node) && ts.isIdentifier(node.name) &&
          ["alt", "aria-label", "placeholder", "title"].includes(node.name.text) &&
          node.initializer && ts.isStringLiteral(node.initializer)) {
          const value = node.initializer.text;
          if (/[a-z]{2}/i.test(value) && !/^https?:\/\//.test(value)) untranslated.push(path + ": " + value);
        }
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
          ["t", "translate"].includes(node.expression.text)) {
          const key = node.arguments[0];
          if (key && ts.isStringLiteralLike(key) && !Object.hasOwn(base, key.text) &&
            catalogs.some((messages) => !Object.hasOwn(messages, key.text))) {
            missing.add(key.text);
          }
        }
        ts.forEachChild(node, inspect);
      };
      inspect(source);
    }
  }
  assert.deepEqual([...missing], []);
  assert.deepEqual(untranslated, []);
});
