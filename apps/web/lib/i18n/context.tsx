"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./locales";
import { formatMessage, type MessageValues } from "./message";
import en from "./dictionaries/en.json";
import es from "./dictionaries/es.json";
import fr from "./dictionaries/fr.json";
import it from "./dictionaries/it.json";
import pt from "./dictionaries/pt.json";

const DICTIONARIES: Record<Locale, Record<string, string>> = { en, es, fr, it, pt };
const STORAGE_KEY = "nodedr-locale";

function detectBrowserLocale(): Locale {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  for (const lang of navigator.languages ?? [navigator.language]) {
    const short = lang.slice(0, 2).toLowerCase();
    if (isLocale(short)) return short;
  }
  return DEFAULT_LOCALE;
}

export type Translate = (key: string, vars?: MessageValues) => string;

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  fixedLocale,
}: {
  children: React.ReactNode;
  /**
   * Pins the starting language and never reads or writes the saved choice or
   * the browser language — for a shared public screen (the kiosk), where one
   * customer's language pick must not leak into the staff UI or stick for the
   * next customer.
   */
  fixedLocale?: Locale;
}) {
  // Starts at the fixed default on both server and first client render
  // (so hydration matches), then swaps to the saved/browser locale right
  // after mount — the same pattern the QR page already uses for
  // sessionStorage reads.
  const [locale, setLocaleState] = useState<Locale>(fixedLocale ?? DEFAULT_LOCALE);

  useEffect(() => {
    if (fixedLocale) return;
    const saved = localStorage.getItem(STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocaleState(isLocale(saved) ? saved : detectBrowserLocale());
  }, [fixedLocale]);

  const setLocale = useCallback(
    (next: Locale) => {
      if (!fixedLocale) localStorage.setItem(STORAGE_KEY, next);
      setLocaleState(next);
    },
    [fixedLocale],
  );

  return <LocaleMessages locale={locale} setLocale={setLocale}>{children}</LocaleMessages>;
}

// A staff route can supply its larger catalog while sharing the picker and its saved preference.
export function LocaleMessages({
  children, locale, setLocale, messages,
}: {
  children: React.ReactNode;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  messages?: Record<string, string>;
}) {
  const value = useMemo<I18nContextValue>(() => {
    const dictionary = DICTIONARIES[locale];
    const english = DICTIONARIES[DEFAULT_LOCALE];
    const t = (key: string, vars?: MessageValues) => {
      const source = messages && Object.hasOwn(messages, key) ? messages[key]
        : Object.hasOwn(dictionary, key) ? dictionary[key]
        : Object.hasOwn(english, key) ? english[key] : key;
      return formatMessage(source, vars);
    };
    return { locale, setLocale, t };
  }, [locale, setLocale, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

export { LOCALES, LOCALE_LABELS } from "./locales";
export type { Locale } from "./locales";
