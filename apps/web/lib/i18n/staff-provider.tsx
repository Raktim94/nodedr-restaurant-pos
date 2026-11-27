"use client";

import { use, useDeferredValue, useEffect } from "react";
import { LocaleMessages, useI18n } from "./context";
import { DEFAULT_LOCALE, LOCALE_TAGS, type Locale } from "./locales";

const load = {
  es: () => import("./staff/es.json"),
  fr: () => import("./staff/fr.json"),
  it: () => import("./staff/it.json"),
  pt: () => import("./staff/pt.json"),
};
type TranslatedLocale = keyof typeof load;
const catalogs = new Map<TranslatedLocale, Promise<Record<string, string>>>();

function catalog(locale: TranslatedLocale) {
  let pending = catalogs.get(locale);
  if (!pending) {
    pending = load[locale]().then((module) => module.default);
    catalogs.set(locale, pending);
  }
  return pending;
}

export function StaffLocaleProvider({ children }: { children: React.ReactNode }) {
  const preference = useI18n();
  // Keep the current form and its input visible while the next language's chunk loads.
  const locale = useDeferredValue<Locale>(preference.locale, DEFAULT_LOCALE);
  const messages = locale === "en" ? undefined : use(catalog(locale));
  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = LOCALE_TAGS[locale];
    return () => { document.documentElement.lang = previous; };
  }, [locale]);
  return (
    <LocaleMessages locale={locale} setLocale={preference.setLocale} messages={messages}>
      {children}
    </LocaleMessages>
  );
}
