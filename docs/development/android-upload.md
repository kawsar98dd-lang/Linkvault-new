# Android-only upload and verification (main branch)

This project is being maintained on the repository default branch only. Do not create a review branch for this workflow.

1. Upload the release ZIP to the repository root on `main` using GitHub's **Add file → Upload files**, then commit it.
2. Open **Actions → import-zip → Run workflow**. Select the default branch under **Use workflow from**.
3. Set `zip_path` to the exact uploaded ZIP filename. Run once with `dry_run=true`.
4. If and only if the dry run succeeds, run again with `dry_run=false`. The workflow validates the ZIP before extraction, does not execute its contents, adds/updates project files without deleting other project files, and removes only the uploaded ZIP after applying it.
5. Then run **Actions → generate-lockfile → Run workflow**. It resolves and checks Better Auth, generates the lockfile, and runs required checks. It should push to the default branch only if required checks pass. A normal push may be rejected by branch protection; do not disable protections merely to force the push.
6. A successful import or lockfile workflow is not proof of production readiness. Read workflow summaries and artifacts.

The ZIP importer does not install dependencies on your phone. GitHub-hosted runners do the checks. The app still requires Node.js and PostgreSQL; Cloudflare production deployment is not configured or verified in this release.
