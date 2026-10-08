import { describe, expect, it } from 'vitest';
import { bn, direction, en, isLocale, negotiateLocale, t } from '../src/index.ts';

describe('i18n', () => {
  it('bn keys are a subset of en keys (no orphaned keys)', () => {
    for (const k of Object.keys(bn)) expect(Object.keys(en)).toContain(k);
  });
  it('falls back to English for untranslated keys', () => {
    expect(t('bn', 'email.verify.subject')).toBe(en['email.verify.subject']);
    expect(t('bn', 'error.not_found')).toBe(bn['error.not_found']);
  });
  it('interpolates params and leaves unknown placeholders intact', () => {
    expect(t('en', 'email.invite.subject', { workspace: 'Acme' })).toContain('Acme');
    expect(t('en', 'email.verify.body', { name: 'A' })).toContain('{url}');
  });
  it('negotiates locale with q-values', () => {
    expect(negotiateLocale(undefined)).toBe('en');
    expect(negotiateLocale('bn-BD,bn;q=0.9,en;q=0.5')).toBe('bn');
    expect(negotiateLocale('fr;q=0.9, en;q=0.2')).toBe('en');
    expect(negotiateLocale('bn;q=0, en')).toBe('en');
    expect(negotiateLocale('xx')).toBe('en');
  });
  it('guards locale values and direction', () => {
    expect(isLocale('bn')).toBe(true);
    expect(isLocale('ar')).toBe(false);
    expect(direction('en')).toBe('ltr');
  });
});
