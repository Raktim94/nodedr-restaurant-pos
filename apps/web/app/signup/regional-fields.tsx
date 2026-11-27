import { useEffect, useMemo } from "react";
import type { UseFormReturn } from "react-hook-form";
import { COUNTRY_CODES, TAX_REGIMES, type RegisterDto, type TaxRegime } from "@nodedr-restaurant/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { countryOptions } from "@/lib/countries";
import { useI18n } from "@/lib/i18n/context";
import { suggestCurrency, suggestRegion } from "../../../../mobile/www/pos/lib/region-currency.js";

const EU_COUNTRIES = "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI SE".split(" ");

function taxPreset(country: string): TaxRegime {
  if (country === "IN") return "INDIA_GST";
  if (country === "US") return "US_SALES_TAX";
  if (country === "ES") return "ES_IVA";
  return EU_COUNTRIES.includes(country) ? "EU_VAT" : "CUSTOM";
}

const selectClass = "h-9 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-ring";

export function RegionalFields({ form }: { form: UseFormReturn<RegisterDto> }) {
  const { locale, t } = useI18n();
  const { register, setValue, getFieldState, formState: { errors } } = form;
  const countries = useMemo(() => countryOptions(locale), [locale]);
  const currencies = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: "currency" });
    return (Intl.supportedValuesOf?.("currency") ?? []).map(code => ({ code, name: names.of(code) }));
  }, [locale]);

  useEffect(() => {
    const country = suggestRegion(navigator.languages?.length ? navigator.languages : [navigator.language]);
    if (COUNTRY_CODES.includes(country) && !getFieldState("regionalSettings.country").isDirty) {
      setValue("regionalSettings.country", country);
      setValue("regionalSettings.currency", suggestCurrency(country));
      setValue("regionalSettings.taxRegime", taxPreset(country));
    }
    if (!getFieldState("regionalSettings.timezone").isDirty) {
      setValue("regionalSettings.timezone", Intl.DateTimeFormat().resolvedOptions().timeZone ?? "");
    }
  }, [getFieldState, setValue]);

  const regionalErrors = errors.regionalSettings;
  return (
    <fieldset className="grid gap-4 border-t border-border pt-3">
      <legend className="pr-2 text-sm font-semibold">{t("signup.regional")}</legend>
      <p className="text-sm text-muted-foreground">{t("signup.regionalHint")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-2">
          <Label htmlFor="country">{t("signup.country")}</Label>
          <select id="country" className={selectClass} required {...register("regionalSettings.country", {
            onChange: (event) => {
              const country: string = event.target.value;
              if (!getFieldState("regionalSettings.currency").isDirty) setValue("regionalSettings.currency", suggestCurrency(country));
              if (!getFieldState("regionalSettings.taxRegime").isDirty) setValue("regionalSettings.taxRegime", taxPreset(country));
            },
          })}>
            <option value="">{t("signup.chooseCountry")}</option>
            {countries.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
          </select>
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor="currency">{t("signup.currency")}</Label>
          <Input id="currency" required maxLength={3} list="signup-currencies" placeholder={t("signup.currencyHint")}
            aria-invalid={!!regionalErrors?.currency} {...register("regionalSettings.currency")} />
          <datalist id="signup-currencies">
            {currencies.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
          </datalist>
          {regionalErrors?.currency && <p role="alert" className="text-xs text-destructive">{t("signup.invalidCurrency")}</p>}
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor="timezone">{t("signup.timezone")}</Label>
          <Input id="timezone" required list="signup-timezones" aria-invalid={!!regionalErrors?.timezone} {...register("regionalSettings.timezone")} />
          <datalist id="signup-timezones">
            <option value="UTC" />
            {(Intl.supportedValuesOf?.("timeZone") ?? []).map(zone => <option key={zone} value={zone} />)}
          </datalist>
          {regionalErrors?.timezone && <p role="alert" className="text-xs text-destructive">{t("signup.invalidTimezone")}</p>}
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor="taxRegime">{t("signup.tax")}</Label>
          <select id="taxRegime" className={selectClass} defaultValue="CUSTOM" {...register("regionalSettings.taxRegime")}>
            {TAX_REGIMES.map(regime => <option key={regime} value={regime}>{t(`signup.tax.${regime}`)}</option>)}
          </select>
        </div>
      </div>
    </fieldset>
  );
}
