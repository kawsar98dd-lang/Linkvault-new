# BnlinkVault 0.2.2 — হ্যান্ডঅফ ও পরবর্তী কাজ

## এই ZIP-এ কী বদলেছে
- আগের 0.2.1-prep ZIP-এর application source, API, auth, database schema ও security architecture রাখা হয়েছে।
- GitHub Actions ZIP import ও dependency bootstrap workflow এবং Android নির্দেশিকা main/default branch-এ কাজ করার জন্য আপডেট করা হয়েছে।
- Import workflow ZIP validate না হওয়া পর্যন্ত extract করে না; apply সফল হলে শুধু workflow input হিসেবে দেওয়া ZIP ফাইলটি repository থেকে সরায়। অন্য project source file মুছে না।
- Force push ব্যবহার করা হয়নি।

## কী এখনো সম্পন্ন নয়
- Better Auth dependency resolution এবং pnpm-lock.yaml generation বাস্তবে চালানো হয়নি।
- GitHub Actions CI, TypeScript, lint, tests, PostgreSQL/RLS, production build ও deployment এখনো unverified।
- Core short links, redirects, customer dashboard, analytics, custom domains, monetization ও billing এখনো সম্পূর্ণ তৈরি হয়নি।

## Android-এ করণীয়
1. ZIP-টি repository root-এ main branch-এ upload করে commit করুন।
2. Actions → import-zip চালান, প্রথমে `dry_run=true`।
3. Dry run সফল হলে `dry_run=false` দিয়ে apply করুন।
4. এরপর Actions → generate-lockfile চালান।
5. কোনো workflow ব্যর্থ হলে আরেকবার apply বা জোর করে push করবেন না; log/স্ক্রিনশট দিন।

## গুরুত্বপূর্ণ
এই ZIP একটি নিরাপদ workflow/documentation update, পূর্ণাঙ্গ sellable SaaS release নয়।
