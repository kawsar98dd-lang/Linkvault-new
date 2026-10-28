# BnlinkVault 0.2.5 — Lockfile Peer Dependency Repair

তারিখ: 2026-10-28

## স্ক্রিনশট থেকে নিশ্চিত তথ্য

`generate-lockfile #8`-এ `pnpm install --lockfile-only` ধাপে `ERR_PNPM_PEER_DEP_ISSUES` হয়েছে। তাই lockfile তৈরি/ইনস্টল-পরবর্তী কাজ, Prettier, TypeScript, ESLint, tests এবং commit সম্পন্ন হয়নি।

লগে আগের `webpack@5.98.0`-এর বদলে `^5.112.0`-এর প্রয়োজন দেখা যাচ্ছে। একই লগে Sentry dependency tree-তে `@opentelemetry/api@1.10.0` peer range ` <1.10.0`-এর সঙ্গে সংঘাত করছে।

## এই ZIP-এ পরিবর্তন

- `pnpm-workspace.yaml`: webpack catalog pin `5.112.0` করা হয়েছে।
- `pnpm-workspace.yaml`: `@opentelemetry/api`-এর exact override `1.9.0` ফিরিয়ে আনা হয়েছে।
- peer dependency strictness অপরিবর্তিত: `.npmrc`-এ `strict-peer-dependencies=true` এবং `auto-install-peers=false` রয়েছে।
- আগের formatting correction রাখা হয়েছে: bootstrap workflow-এ `pnpm format`-এর পর `pnpm format:check` চলে।
- `pnpm-lock.yaml` তৈরি/নকল করা হয়নি।

## Android থেকে করণীয়

1. ZIP-টি GitHub repository root-এ upload করুন।
2. Actions → `import-zip`-এ আগে `dry_run=true` দিয়ে যাচাই করুন; সফল হলে workflow-এর নির্দেশনা অনুযায়ী apply করুন।
3. Import summary-তে `pending-workflows/generate-lockfile.yml` তৈরি/আপডেট হয়েছে কি না দেখুন।
4. GitHub-এর `main` branch-এ `.github/workflows/generate-lockfile.yml` খুলে pending workflow-এর সম্পূর্ণ content বসিয়ে commit করুন। Importer ইচ্ছাকৃতভাবে workflow ফাইল সরাসরি প্রতিস্থাপন করে না।
5. এরপর `generate-lockfile` একবার চালান এবং সম্পূর্ণ log দেখুন।
6. আবার peer conflict হলে strict check বন্ধ করবেন না; ব্যর্থতার log/screenshot দিন।

## যাচাইয়ের সীমা

এই প্যাকেজে source/text পরিবর্তন ও ZIP integrity যাচাই করা হবে; registry থেকে webpack 5.112.0 পাওয়া যায় কি না, বাস্তব pnpm install, lockfile, Prettier, TypeScript, ESLint, tests, DB/RLS, build বা security checks এখানে সফল হয়েছে—এমন দাবি করা হচ্ছে না। Phase 2-এর অবস্থা `IMPLEMENTED — UNVERIFIED`।
