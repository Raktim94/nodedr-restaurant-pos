// Supported UI languages (2026-09-27). Adding a language: add its code
// here, drop a matching dictionary file in ./dictionaries, and it shows up
// in the language switcher automatically — no other code changes needed.
export const LOCALES = ["en", "es", "fr"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
};

export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}
