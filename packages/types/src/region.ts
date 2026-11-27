import { z } from "zod";

// ISO 3166-1 alpha-2, plus XK (Kosovo), already offered by the country picker.
export const COUNTRY_CODES: readonly string[] = `
  AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
  CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
  GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT
  JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN
  MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT
  PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM
  TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW
`.trim().split(/\s+/);

export const countryCodeSchema = z.string().trim()
  .regex(/^[a-z]{2}$/i, "Choose a valid country").toUpperCase()
  .refine((code) => COUNTRY_CODES.includes(code), "Choose a valid country");

// Older browsers can still submit the code. The API runs on Node 22+ and
// always checks it against ICU's currency list.
const supportedCurrencies = Intl.supportedValuesOf?.("currency");
export const currencyCodeSchema = z.string().trim()
  .regex(/^[a-z]{3}$/i, "Choose a valid currency").toUpperCase()
  .refine((code) => supportedCurrencies?.includes(code) ?? true, "Choose a valid currency");

export const timezoneSchema = z.string().trim().max(100).refine((timeZone) => {
  // Newer Intl implementations also accept numeric offsets. Store a zone
  // name so local dates can follow daylight-saving and historical changes.
  if (!/^[A-Za-z]/.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}, "Choose a valid IANA time zone");
