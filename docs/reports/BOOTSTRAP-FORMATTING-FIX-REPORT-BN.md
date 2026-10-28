# BnlinkVault 0.2.3 — GitHub Actions Formatting Blocker Fix Report (বাংলা)

তারিখ: 2026-10-28  
ভিত্তি: ব্যবহারকারীর দেওয়া GitHub Actions স্ক্রিনশট এবং `BnlinkVault-marketplace-prep-0.2.3.zip`-এর ফাইল পর্যালোচনা।

## স্ক্রিনশটে নিশ্চিত হওয়া অবস্থা

- `import-zip` রান সফল হয়েছে; ZIP validation pass হওয়া শুধু আর্কাইভ যাচাই, অ্যাপ build/test pass নয়।
- `generate-lockfile`-এ Better Auth registry + OSV gate সফল হয়েছে।
- `pnpm-lock.yaml` generate এবং frozen install সফল হয়েছে।
- পরবর্তী `pnpm format:check` ধাপে ব্যর্থ হয়েছে: 128/129 ফাইলে Prettier formatting issue রিপোর্ট হয়েছে।
- Formatting ব্যর্থ হওয়ার কারণে TypeScript, ESLint, unit tests এবং default branch-এ lockfile commit ধাপগুলো চালানো হয়নি/skip হয়েছে।
- তাই lockfile তৈরি হওয়া runner-এর অস্থায়ী workspace-এ সফল হলেও repository-তে commit হয়েছে—এমন প্রমাণ নেই।

## এই আপডেটে কী বদলানো হয়েছে

1. `.github/workflows/generate-lockfile.yml`-এ শুধু check করে থেমে না থেকে repository-এর নির্ধারিত Prettier config দিয়ে `pnpm format` চালানো হবে; তারপর `pnpm format:check` দিয়ে ফল যাচাই হবে।
2. formatting-এর পর TypeScript, ESLint এবং tests আগের মতো blocking থাকবে। এগুলো pass না করলে workflow commit ধাপে পৌঁছাবে না।
3. সব checks pass হলে lockfile ও verified dependency pin-এর পাশাপাশি ইতিমধ্যে tracked source/docs-এর formatting পরিবর্তনও normal commit-এ অন্তর্ভুক্ত হবে। `.github/workflows/` ফাইল auto-format করা হয় না।
4. workflow static test-এ পুরোনো `chore/bootstrap` branch প্রত্যাশা সরিয়ে default/main branch-only আচরণ যাচাই করা হয়েছে।
5. এই রিপোর্ট ও handoff-এর পরবর্তী ধাপ ZIP-এর মধ্যে রাখা হয়েছে।

## গুরুত্বপূর্ণ সীমাবদ্ধতা

- GitHub-এর `import-zip` workflow `.github/workflows/**` সরাসরি কপি করে না; পরিবর্তিত workflow `pending-workflows/`-এ রাখে। তাই এই ZIP import করলেই সক্রিয় `generate-lockfile.yml` বদলে যাবে না। সক্রিয় workflow-তে পরিবর্তিত ফাইলটি GitHub editor দিয়ে বসাতে হবে।
- Prettier-এর প্রকৃত format, dependency resolution, TypeScript, ESLint, Vitest, PostgreSQL/RLS, Next.js build বা security scans এই পরিবেশে চালানো হয়নি।
- এই আপডেট CI green, production readiness বা marketplace readiness-এর দাবি করে না।
- কোনো security gate সরানো হয়নি; `strict-peer-dependencies=true` বজায় আছে।
- কেবল repository default/main branch ব্যবহার করতে হবে; নতুন branch বা force-push নয়।

## পরবর্তী কাজ

1. ZIP import workflow-তে dry-run/apply summary-তে `pending-workflows/generate-lockfile.yml` এসেছে কি না যাচাই করুন।
2. GitHub-এ `.github/workflows/generate-lockfile.yml` খুলে ফাইলের বিষয়বস্তু আপডেট করা সংস্করণ দিয়ে প্রতিস্থাপন করে `main`-এ commit করুন।
3. Actions → `generate-lockfile` → Run workflow চালান।
4. প্রথমে `pnpm format` ও `pnpm format:check` শেষ হতে দিন; তারপর TypeScript/ESLint/tests-এর প্রথম প্রকৃত error দেখুন।
5. নতুন ব্যর্থতা এলে সম্পূর্ণ failing step-এর screenshot/log দিন। `PHASE-2-VERIFICATION-STATUS.md`-এর অবস্থা তখনও `PHASE 2 IMPLEMENTED — UNVERIFIED` থাকবে, যতক্ষণ না বাস্তব সব exit criteria যাচাই হয়।
