// The staff and QR language pickers use this list. Register each dictionary in context.tsx.
export const LOCALES = ["en", "es", "fr", "it", "pt"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_TAGS: Record<Locale, string> = {
  en: "en-GB",
  es: "es-ES",
  fr: "fr-FR",
  it: "it-IT",
  pt: "pt-BR",
};

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  it: "Italiano",
  pt: "Português (Brasil)",
};

export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}
