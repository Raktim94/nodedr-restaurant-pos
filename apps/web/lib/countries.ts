import { COUNTRY_CODES } from "@nodedr-restaurant/types";

export function countryOptions(locale = "en"): { code: string; name: string }[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale], { type: "region" });
  } catch {
    names = null;
  }
  return COUNTRY_CODES.map((code) => ({ code, name: names?.of(code) ?? code })).sort((a, b) =>
    a.name.localeCompare(b.name, locale),
  );
}
