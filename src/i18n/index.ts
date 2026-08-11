import { App, getLanguage } from "obsidian";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

type Dict = Record<string, string>;

const locales: Record<string, Dict> = {
  en: en as Dict,
  zh: zh as Dict,
  // region/locale aliases map onto the base language dictionary
  "zh-cn": zh as Dict,
  "zh-tw": zh as Dict,
  "zh-hans": zh as Dict,
  "zh-hant": zh as Dict,
};

let currentLang = "en";

/** Call once in `onload()` so the active language follows Obsidian's setting. */
export function initI18n(_app?: App): void {
  currentLang = getLanguage() || "en";
}

export function getLang(): string {
  return currentLang;
}

/**
 * Translate a key for the active language, with optional `{var}` interpolation.
 * Falls back to the English dictionary, then to the raw key (so missing keys
 * are visible rather than silently empty).
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const dict =
    locales[currentLang] ?? locales[currentLang.split("-")[0]] ?? locales["en"];
  let str: string = (dict && dict[key]) ?? locales["en"][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      // split/join avoids regex metacharacter issues in interpolated values
      str = str.split("{" + k + "}").join(String(v));
    }
  }
  return str;
}
