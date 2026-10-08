# Secret protection

| control | where | status |
|---|---|---|
| Built-in repo scanner (`scripts/scan-secrets.mjs`, rules in `scripts/lib/secret-patterns.mjs`) | CI `static` | **executed at authoring time on this tree: no findings** |
| Gitleaks (full history, `.gitleaks.toml` incl. legacy `SECRET_KEY`/`ADMIN_HASH` rules) | CI `security` | NOT RUN (tool unavailable) |
| Browser-bundle scan (`scripts/scan-browser-bundle.mjs`): canary env values + secret names + patterns in `.next/static` | CI `web` | scanner logic unit-tested; **real bundle NOT scanned (no build)** |
| `NEXT_PUBLIC_*` name validation (`assertPublicEnvIsSafe`) | runtime | unit tested in CI |
| `server-only` imports on server modules | build | NOT RUN |
| Semgrep (`p/secrets` + security rulesets), blocking | CI `semgrep` | NOT RUN (tool/network unavailable) |
| Dependabot (npm + actions), `pnpm audit`, dependency-review | CI | NOT RUN |

The scanners print only a short prefix of any finding. Inline escape hatch: `secretscan:allow` with justification.
