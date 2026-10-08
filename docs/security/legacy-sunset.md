# Legacy static system: sunset decision

The previous implementation (static pages with a browser-shipped `SECRET_KEY`, client-side AES "locking",
client-side countdown, a hash-compare "admin mode" and an is.gd JSONP shortener) is **not** part of this
repository and is **not** migrated.

Decisions (Architecture Spec v1.0 §25, U6):
- No compatibility bridge or server-side decrypt resolver for legacy links: the key was public, so legacy
  links are forgeable and a resolver would recreate an open-gateway phishing vector.
- No new legacy links may be created. Take the old deployment's generator offline or replace it with a
  notice, and set a sunset date.
- The old repository should be archived (tag `legacy-v1`); do not copy its code, `SECRET_KEY` or ad keys here.
- Guards: `.gitleaks.toml`, `scripts/lib/secret-patterns.mjs` (`legacy-*` rules) and the bundle scanner fail CI
  if `SECRET_KEY`/`ADMIN_HASH`/`window.LV_SITE` patterns reappear.
- The legacy `SECRET_KEY` value was exposed publicly; treat it as compromised (it protects nothing).
