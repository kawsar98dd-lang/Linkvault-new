import { en } from './messages/en.ts';
import { bn } from './messages/bn.ts';

export const LOCALES = ['en', 'bn'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
/** Locales rendered right-to-left. Empty in Phase 2 (ar arrives with the i18n phase). */
export const RTL_LOCALES: readonly string[] = [];

export type MessageKey = keyof typeof en;
export type Messages = Readonly<Record<MessageKey, string>>;

const catalogs: Readonly<Record<Locale, Partial<Messages>>> = { en, bn };

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

export function direction(locale: string): 'ltr' | 'rtl' {
  return RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr';
}

/** Picks the best supported locale from an Accept-Language header (q-values honoured). */
export function negotiateLocale(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q ? Number.parseFloat(q.slice(2)) : 1;
      return { tag: tag.toLowerCase(), weight: Number.isFinite(weight) ? weight : 0 };
    })
    .filter((x) => x.tag && x.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  for (const { tag } of ranked) {
    const primary = tag.split('-')[0];
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

/**
 * Minimal `{name}` interpolation (no plural/select). Full ICU MessageFormat arrives with the
 * dedicated i18n phase; keys and call sites stay unchanged.
 */
export function t(locale: Locale, key: MessageKey, params: Readonly<Record<string, string | number>> = {}): string {
  const template = catalogs[locale][key] ?? en[key];
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params[name];
    return v === undefined ? whole : String(v);
  });
}

export { en, bn };
