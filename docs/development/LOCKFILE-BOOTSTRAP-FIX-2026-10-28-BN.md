# Lockfile bootstrap correction — 2026-10-28 (বাংলা)

## কী সমস্যা দেখা গেছে
GitHub Actions-এর `generate-lockfile #5` run ব্যর্থ হয়েছে। দেওয়া স্ক্রিনশটে শুধু `bootstrap — Process completed with exit code 1` দেখা যায়; কোন step-এ error হয়েছে তার expanded log দেখা যায় না। `Node.js 20 is deprecated` এবং `ubuntu-latest` migration নোট warning/info, এগুলো একা failure-এর কারণ প্রমাণ করে না।

## এই আপডেটে কী বদলেছে
1. `scripts/pin-better-auth.mjs` এখন npm registry ও OSV request-এ transient network/HTTP সমস্যা হলে সর্বোচ্চ ৩ বার retry করে।
2. Better Auth version floor, stable/non-deprecated version এবং OSV security gate অপরিবর্তিত—কোনো security check bypass করা হয়নি।
3. `generate-lockfile.yml`-এ pnpm `10.8.0` স্পষ্টভাবে pin করা হয়েছে।
4. প্রতিটি গুরুত্বপূর্ণ bootstrap step-এ ID যোগ হয়েছে; run শেষে GitHub Actions Summary-তে কোন step `success`, `failure` বা `skipped` হয়েছে তা দেখাবে।
5. diagnostic log artifact upload করার ব্যবস্থা রাখা হয়েছে।
6. bootstrap workflow শুধু repository-র default branch-এ normal push করে; নতুন branch বা force-push ব্যবহার করে না।
7. stale tests-এ main/default-branch policy অনুযায়ী assertion আপডেট করা হয়েছে।

## লোকাল যাচাই
- `node --test scripts/__tests__/*.test.mjs`: **63/63 PASS** (এই ZIP-এর scripts/tests, লোকাল Node.js 22.16.0-এ)।
- এটি GitHub Actions, dependency install, app typecheck/build, PostgreSQL/RLS, Semgrep/Gitleaks বা production deployment-এর green result নয়।
- এই পরিবেশে npm registry/OSV থেকে live dependency resolution করে সত্যিকারের `pnpm-lock.yaml` তৈরি করা হয়নি। তাই lockfile এখনও তৈরি হয়নি।

## Android থেকে পরবর্তী কাজ
1. আপডেট ZIP-টি GitHub repo root-এ main/default branch-এ upload ও commit করুন।
2. `Actions → import-zip` চালিয়ে `dry_run=true` রাখুন। Summary সফল হলে একই ZIP path দিয়ে আবার `dry_run=false` চালান।
3. গুরুত্বপূর্ণ: বর্তমান `import-zip` নিরাপত্তার কারণে ZIP-এর `.github/workflows/**` সরাসরি workflow directory-তে কপি করে না; পরিবর্তিত workflow ফাইলগুলো `pending-workflows/`-এ রাখে। তাই import-এর পর `pending-workflows/generate-lockfile.yml`-এর content-টি GitHub editor দিয়ে `.github/workflows/generate-lockfile.yml`-এ বসিয়ে commit করতে হবে (existing workflow file replace করে)। এটি না করলে নতুন diagnostic summary workflow সক্রিয় হবে না; script retry পরিবর্তন অবশ্যই import হবে।
4. এরপর `Actions → generate-lockfile → Run workflow` main/default branch থেকে চালান।
5. ব্যর্থ হলে run summary-তে `Resolve Better Auth`, `Security gate`, `Generate pnpm-lock.yaml`—কোন ধাপে `failure` দেখায় সেটি দেখুন। **Security gate fail করলে সেটি bypass করবেন না**; failing step-এর expanded log বা summary screenshot দিন।
6. Lockfile তৈরি এবং commit না হওয়া পর্যন্ত CI সবুজ বা Phase 2 verified বলা যাবে না।

## সতর্কতা
এই আপডেটটি bootstrap failure diagnosis/retry উন্নত করে; screenshot-এ প্রকৃত error line না থাকায় আগের failure-এর root cause নিশ্চিতভাবে চিহ্নিত করা সম্ভব হয়নি। নিরাপত্তা যাচাই এড়িয়ে lockfile বানানো হয়নি।
