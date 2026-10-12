# Getting the full project into GitHub from a phone (no git client)

Hidden items (`.github`, `.gitignore`, `.npmrc`) and nested folders cannot be selected reliably in an Android file
picker, and the GitHub web uploader accepts at most 100 files at a time. Upload **one ZIP file** instead and let the
`import-zip` workflow extract it.

1. In the repository on the web (branch `main`): **Add file → Create new file**, name it
   `.github/workflows/import-zip.yml`, paste the contents of that file (also available as
   `docs/development/import-zip.workflow.yml`) and commit. It only adds a manually started workflow.
2. **Add file → Upload files**, choose the project ZIP, and select **"Create a new branch for this commit"**
   (for example `upload-v5`). Do **not** commit the ZIP to `main`.
3. **Actions → import-zip → Run workflow**: _Use workflow from_ = `upload-v5` (never `main`). Keep `dry_run` ticked
   for the first run. It only validates the ZIP and prints its SHA-256.
4. If the dry run is green, run it again with `dry_run` unticked (optionally paste the SHA-256 into
   `expected_sha256`). The project is added to the branch `chore/bootstrap` (created from `main`, or continued if it
   exists). Nothing is deleted, nothing is force-pushed, `main` is never written.
5. Workflow files from the ZIP are **not** copied into `.github/workflows` (the built-in token may not change them).
   They are saved in `pending-workflows/`; the run summary lists each one as NEW or CHANGED. On the branch
   `chore/bootstrap`, move or paste each file into `.github/workflows/` with the GitHub web editor.
6. **Actions → generate-lockfile → Run workflow** with _Use workflow from_ = `chore/bootstrap`. It resolves and verifies
   the Better Auth pin and generates the lockfile on that branch.
7. Open a pull request `chore/bootstrap → main`; CI (`ci`, CodeQL, dependency-review) runs. Merge only when green.
