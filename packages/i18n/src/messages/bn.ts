import type { en } from './en.ts';

/** Bengali skeleton: partial by design in Phase 2; missing keys fall back to English. */
export const bn: Partial<Record<keyof typeof en, string>> = {
  'error.unauthenticated': 'অনুগ্রহ করে লগইন করুন।',
  'error.forbidden': 'এই কাজটি করার অনুমতি আপনার নেই।',
  'error.not_found': 'অনুরোধ করা রিসোর্স পাওয়া যায়নি।',
  'error.rate_limited': 'অনেক বেশি অনুরোধ। কিছুক্ষণ পরে আবার চেষ্টা করুন।',
  'error.internal_error': 'একটি অপ্রত্যাশিত ত্রুটি ঘটেছে।',
  'app.name': 'BnlinkVault',
  'app.tagline': 'স্মার্ট লিংক ম্যানেজমেন্ট',
};
