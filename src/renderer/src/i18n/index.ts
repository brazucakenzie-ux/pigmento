import { en } from './en';

export type I18nKey = keyof typeof en;
export type I18nParams = Record<string, string | number>;

let dictionary: Record<string, string> = en;

/** Translate a key, substituting `{name}` placeholders. Unknown keys fall back to the key. */
export function t(key: I18nKey, params?: I18nParams): string {
  let s = dictionary[key] ?? en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

export function hasKey(key: string): key is I18nKey {
  return key in en;
}

/** Swap in another language table (keys missing from it fall back to English). */
export function setDictionary(dict: Partial<Record<I18nKey, string>>): void {
  dictionary = { ...en, ...dict };
}
