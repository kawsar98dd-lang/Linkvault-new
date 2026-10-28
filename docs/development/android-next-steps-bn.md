# Android থেকে পরবর্তী ধাপ (শুধু main branch)

এই সংস্করণে আলাদা review branch ব্যবহার করা হবে না। GitHub repository-র default branch (সাধারণত `main`) ছাড়া অন্য branch তৈরি করার প্রয়োজন নেই।

## ZIP Import
1. এই ZIP ফাইলটি ডাউনলোড করুন।
2. GitHub repository-র `main` branch খুলুন এবং ZIP ফাইলটি repository root-এ `Add file → Upload files` দিয়ে আপলোড করুন; commit করুন।
3. `Actions → import-zip → Run workflow` খুলুন। `Use workflow from`-এ `main` নির্বাচন করুন।
4. `zip_path`-এ আপলোড করা ZIP-এর সঠিক নাম দিন। প্রথমে `dry_run` চালু রাখুন।
5. Dry run সফল হলে একই workflow আবার চালান, এবার `dry_run` বন্ধ করে। এটি ZIP যাচাই করে ফাইল যোগ/আপডেট করবে; ZIP ফাইলটি শেষে repository থেকে সরাবে, কিন্তু প্রকল্পের অন্য ফাইল মুছবে না।
6. Workflow fail হলে আরেকবার apply চালাবেন না; লগ/স্ক্রিনশট দেখে সমস্যা নির্ণয় করুন।

## Dependency যাচাই
Import সফল হওয়ার পর `Actions → generate-lockfile → Run workflow` চালান। এই workflow Better Auth version যাচাই, lockfile তৈরি এবং বাধ্যতামূলক checks চালানোর চেষ্টা করবে। কোনো check ব্যর্থ হলে workflow থামবে; তখন output/log দেখে সমস্যা ঠিক করতে হবে।

## গুরুত্বপূর্ণ
- এই ZIP-এ Core Short Link, Redirect, Dashboard, Analytics বা Billing ফিচার সম্পূর্ণ তৈরি করা হয়নি।
- ZIP Import সফল হওয়া মানে build, database security বা production deployment সফল হওয়া নয়।
- GitHub branch protection থাকলে workflow-এর normal push আটকে যেতে পারে; সেটি জোর করে পাশ কাটাবেন না।
