# Getting the full project into GitHub from a phone (no git client)

Hidden items (`.github`, `.gitignore`, `.npmrc`) and nested folders cannot be selected reliably in an Android file
picker, and the GitHub web uploader accepts at most 100 files at a time. Upload **one ZIP file** instead and let a
workflow extract it.

1. In the repository on the web: **Add file → Create new file**, name it `.github/workflows/import-zip.yml`, paste the
   contents of `docs/development/import-zip.workflow.yml` (from this project), commit to the default branch.
2. **Add file → Upload files**, choose `LinkVault-Phase-2-FULL-PROJECT-v5.zip`, and select
   **"Create a new branch for this commit"** (e.g. `upload-v5`). Do **not** commit it to `main`.
3. **Actions → import-zip → Run workflow**: *Use workflow from* = `upload-v5`; keep the defaults. The project is
   extracted into the new branch `chore/import-v5` (nothing is deleted; the default branch is never written).
4. **Actions → generate-lockfile → Run workflow** with *Use workflow from* = `chore/import-v5`. It resolves and verifies
   the Better Auth pin, generates the lockfile, formats code and writes branch `chore/bootstrap` (replacing the old one).
5. Open a pull request `chore/bootstrap → main`; CI (`ci`, CodeQL, dependency-review) runs. Merge only when green.

Workflow files (`.github/workflows/*`) are not updated by step 3 unless a secret `IMPORT_PAT` exists (a personal access
token with `repo` + `workflow` scope), because GitHub's built-in token may not modify workflow files. Only
`generate-lockfile.yml` differs between v3 and v5; it works unchanged when started from a branch other than
`chore/bootstrap` (as in step 4).
