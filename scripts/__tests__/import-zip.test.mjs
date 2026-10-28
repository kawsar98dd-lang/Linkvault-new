import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Tests for .github/workflows/import-zip.yml. The Python programs embedded in the workflow are extracted and run
// against crafted ZIP files / throw-away git repositories. This proves the validation LOGIC; it does not prove the
// workflow runs on GitHub (only a real GitHub Actions run does that).
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const wfText = readFileSync(join(REPO, '.github/workflows/import-zip.yml'), 'utf8');
const have = (cmd) => spawnSync(cmd, ['--version']).status === 0;
const HAS_PY = have('python3');
const HAS_GIT = have('git');

function heredocs(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (/python3 - <<'PY'$/.test(lines[i])) {
      const body = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== 'PY') body.push(lines[j++]);
      const indent = lines[j].match(/^ */)[0].length;
      out.push(body.map((l) => l.slice(indent)).join('\n') + '\n');
      i = j;
    }
  }
  return out;
}
const [VALIDATE, COPY, TRACKED] = heredocs(wfText);

test('workflow is manual-only, writes only to chore/bootstrap, never forces, never downloads', () => {
  assert.match(wfText, /^on:\n {2}workflow_dispatch:/m);
  assert.doesNotMatch(wfText, /pull_request|push:\s*\n\s+branches|schedule:|workflow_run/);
  assert.match(wfText, /^permissions:\n {2}contents: write\n\n/m); // the only permission, nothing else
  assert.equal((wfText.match(/permissions:/g) ?? []).length, 1);
  assert.match(wfText, /TARGET_BRANCH: chore\/bootstrap/);
  assert.match(wfText, /git push origin "HEAD:refs\/heads\/\$TARGET_BRANCH"/);
  for (const line of wfText.split('\n').filter((l) => /git push/.test(l))) {
    assert.doesNotMatch(line, /--force|\s-f\s|\+|:\s*main|\bmaster\b|--delete/);
  }
  assert.doesNotMatch(wfText, /curl|wget|https?:\/\/(?!github)|set -x|secrets\.|--delete|rm -rf \./);
  assert.match(wfText, /Do not run this from the default branch/);
  assert.match(wfText, /dry_run:[\s\S]*?default: true/);
  assert.equal(VALIDATE && COPY && TRACKED ? 3 : 0, 3, 'three embedded programs found');
});

test('the documentation copy is byte-identical to the real workflow', () => {
  const doc = readFileSync(join(REPO, 'docs/development/import-zip.workflow.yml'), 'utf8');
  assert.equal(doc, wfText);
});

const GOOD = {
  'proj/package.json': JSON.stringify({ name: 'bnlinkvault', packageManager: 'pnpm@10.0.0' }),
  'proj/pnpm-workspace.yaml': 'packages: []\n',
  'proj/.nvmrc': '22\n',
  'proj/.env.example': 'FOO=\n',
  'proj/apps/web/package.json': '{}',
  'proj/packages/db/migrations/0001_init.sql': 'select 1;\n',
  'proj/scripts/check-better-auth-advisory.mjs': '// gate\n',
  'proj/.github/workflows/ci.yml': 'name: ci\n',
  'proj/.github/workflows/generate-lockfile.yml': 'name: g\n',
};
const KEY = ['-----BEGIN RSA ', 'PRIVATE KEY-----'].join('');
const variant = (add = {}, remove = []) => {
  const f = { ...GOOD, ...add };
  for (const r of remove) delete f[r];
  return { files: f };
};
const CASES = {
  good: [variant(), 0, 'PASSED'],
  junk_ok: [variant({ 'proj/docs/.DS_Store': 'x' }), 0, 'junk files skipped: 1'],
  env: [variant({ 'proj/.env': 'A=1' }), 1, 'Environment files'],
  env_production: [variant({ 'proj/.env.production': 'A=1' }), 1, 'Environment files'],
  git_dir: [variant({ 'proj/.git/config': 'x' }), 1, 'Forbidden entry'],
  node_modules: [variant({ 'proj/node_modules/a/i.js': 'x' }), 1, 'Forbidden entry'],
  build_output: [variant({ 'proj/apps/web/.next/x.js': 'x' }), 1, 'Forbidden entry'],
  traversal: [variant({ '../evil.txt': 'x' }), 1, 'Path traversal'],
  traversal_inner: [variant({ 'proj/docs/../../evil': 'x' }), 1, 'Path traversal'],
  absolute: [variant({ '/abs/evil': 'x' }), 1, 'absolute path'],
  backslash: [variant({ 'proj/docs\\evil': 'x' }), 1, 'backslash'],
  two_roots: [variant({ 'other/x.txt': 'x' }), 1, 'exactly one top-level'],
  top_level_file: [variant({ 'stray.txt': 'x' }), 1, 'exactly one top-level'],
  missing_package: [variant({}, ['proj/package.json']), 1, 'missing: package.json'],
  unexpected_dir: [variant({ 'proj/evil/x.txt': 'x' }), 1, 'Unexpected top-level folder'],
  nested_workflow: [variant({ 'proj/.github/workflows/a/b.yml': 'x' }), 1, 'Unexpected file under .github'],
  pem: [variant({ 'proj/docs/server.pem': 'x' }), 1, 'not allowed'],
  private_key_text: [variant({ 'proj/docs/n.md': KEY + '\nabc' }), 1, 'private key'],
  npmrc_token: [variant({ 'proj/.npmrc': '//r.example/:_authToken=abc123456\n' }), 1, 'auth token'],
  wrong_project: [variant({ 'proj/package.json': '{"name":"x","packageManager":"pnpm@9"}' }), 1, 'does not look like'],
  duplicate_case: [variant({ 'proj/docs/A.md': '1', 'proj/docs/a.md': '2' }), 1, 'Duplicate'],
  huge_file: [variant({ 'proj/docs/big.bin': { zeros: 11 * 1024 * 1024 } }), 1, 'too large'],
  symlink: [{ ...variant(), symlinks: { 'proj/docs/link': '/etc/passwd' } }, 1, 'Symbolic links'],
};

const BUILDER = `
import json, os, stat, sys, zipfile
spec = json.load(open(sys.argv[1]))
for name, case in spec.items():
    with zipfile.ZipFile(os.path.join(sys.argv[2], name + '.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
        for path, content in case['files'].items():
            data = b'\\0' * content['zeros'] if isinstance(content, dict) else content.encode()
            z.writestr(path, data)
        for path, target in case.get('symlinks', {}).items():
            zi = zipfile.ZipInfo(path)
            zi.external_attr = (stat.S_IFLNK | 0o777) << 16
            z.writestr(zi, target)
`;

function runPy(src, env, cwd) {
  return spawnSync('python3', ['-'], { input: src, env: { ...process.env, ...env }, cwd, encoding: 'utf8' });
}
function sandbox() {
  const ws = mkdtempSync(join(tmpdir(), 'iz-ws-'));
  const tmp = mkdtempSync(join(tmpdir(), 'iz-tmp-'));
  writeFileSync(join(tmp, 'env'), '');
  writeFileSync(join(tmp, 'sum'), '');
  const env = { GITHUB_WORKSPACE: ws, RUNNER_TEMP: tmp, GITHUB_ENV: join(tmp, 'env'), GITHUB_STEP_SUMMARY: join(tmp, 'sum') };
  return { ws, tmp, env };
}

test('ZIP validator accepts a clean project ZIP and rejects every unsafe or unexpected archive', { skip: !HAS_PY }, () => {
  const { ws, tmp, env } = sandbox();
  const spec = Object.fromEntries(Object.entries(CASES).map(([k, v]) => [k, v[0]]));
  writeFileSync(join(tmp, 'spec.json'), JSON.stringify(spec));
  const built = spawnSync('python3', ['-c', BUILDER, join(tmp, 'spec.json'), ws], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  for (const [name, [, code, text]] of Object.entries(CASES)) {
    const r = runPy(VALIDATE, { ...env, ZIP_PATH: `${name}.zip`, EXPECTED_SHA256: '' }, ws);
    assert.equal(r.status, code, `${name}: exit ${r.status}\n${r.stdout}${r.stderr}`);
    assert.ok((r.stdout + r.stderr).includes(text), `${name}: expected "${text}" in\n${r.stdout}${r.stderr}`);
  }
  // a successful run stages the files and leaves everything that is unsafe out of the staging folder
  assert.equal(existsSync(join(tmp, 'stage')), true);
});

test('ZIP validator rejects bad zip_path values, missing files, non-ZIP files and a wrong SHA-256', { skip: !HAS_PY }, () => {
  const { ws, tmp, env } = sandbox();
  writeFileSync(join(tmp, 'spec.json'), JSON.stringify({ good: variant() }));
  spawnSync('python3', ['-c', BUILDER, join(tmp, 'spec.json'), ws]);
  writeFileSync(join(ws, 'notzip.zip'), 'hello');
  mkdirSync(join(ws, 'sub'));
  symlinkSync('/etc/hostname', join(ws, 'linked.zip'));
  const run = (zip, sha = '') => runPy(VALIDATE, { ...env, ZIP_PATH: zip, EXPECTED_SHA256: sha }, ws);
  for (const bad of ['../x.zip', '/abs.zip', 'a//b.zip', '.git/x.zip', 'x.txt', 'a b.zip', '$(id).zip']) {
    assert.equal(run(bad).status, 1, bad);
  }
  assert.match(run('missing.zip').stdout, /ZIP not found/);
  assert.match(run('notzip.zip').stdout, /not a valid ZIP/);
  assert.match(run('linked.zip').stdout, /ZIP not found/); // symlinked ZIP refused
  assert.match(run('good.zip', 'f'.repeat(64)).stdout, /does not match expected_sha256/);
  assert.match(run('good.zip', 'xyz').stdout, /64 hexadecimal/);
  const ok = run('good.zip');
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const sha = /sha256 `([0-9a-f]{64})`/.exec(ok.stdout)[1];
  assert.equal(run('good.zip', sha.toUpperCase()).status, 0); // a matching pin is accepted
});

function gitRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'iz-repo-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'seed');
  return { dir, git };
}
function stageFiles(tmp, files) {
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(tmp, 'stage', p)), { recursive: true });
    writeFileSync(join(tmp, 'stage', p), c);
  }
  writeFileSync(join(tmp, 'manifest.json'), JSON.stringify({ files: Object.keys(files).sort() }));
}

test('copy step: adds/updates files, never deletes, never writes .github/workflows, parks workflows in pending-workflows/', { skip: !HAS_PY || !HAS_GIT }, () => {
  const { dir } = gitRepo({
    '.github/workflows/ci.yml': 'name: old-ci\n',
    '.github/workflows/same.yml': 'name: same\n',
    'OLD-STATIC.txt': 'keep me\n',
    'package.json': '{"old":true}\n',
  });
  const { tmp, env } = sandbox();
  stageFiles(tmp, {
    '.github/workflows/ci.yml': 'name: new-ci\n',
    '.github/workflows/same.yml': 'name: same\n',
    '.github/workflows/codeql.yml': 'name: codeql\n',
    'package.json': '{"name":"bnlinkvault"}\n',
    'apps/web/a.txt': 'a\n',
  });
  const r = runPy(COPY, { ...env, GITHUB_WORKSPACE: dir }, dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rd = (p) => readFileSync(join(dir, p), 'utf8');
  assert.equal(rd('.github/workflows/ci.yml'), 'name: old-ci\n'); // untouched
  assert.equal(existsSync(join(dir, '.github/workflows/codeql.yml')), false); // not created
  assert.equal(rd('pending-workflows/ci.yml'), 'name: new-ci\n');
  assert.equal(rd('pending-workflows/codeql.yml'), 'name: codeql\n');
  assert.equal(existsSync(join(dir, 'pending-workflows/same.yml')), false); // identical: nothing to do
  assert.equal(rd('OLD-STATIC.txt'), 'keep me\n'); // never deleted
  assert.equal(rd('package.json'), '{"name":"bnlinkvault"}\n');
  assert.equal(rd('apps/web/a.txt'), 'a\n');
  assert.match(r.stdout, /NOT in the ZIP \(left untouched\): 1/);
  const expected = JSON.parse(readFileSync(join(tmp, 'expected.json'), 'utf8'));
  assert.ok(expected.includes('pending-workflows/ci.yml') && expected.includes('apps/web/a.txt'));
});

test('copy step refuses to write through a symlink that already exists in the repository', { skip: !HAS_PY || !HAS_GIT }, () => {
  const { dir } = gitRepo({ 'README.md': 'x\n' });
  const outside = mkdtempSync(join(tmpdir(), 'iz-outside-'));
  symlinkSync(outside, join(dir, 'docs'));
  const { tmp, env } = sandbox();
  stageFiles(tmp, { 'docs/a.md': 'pwned\n' });
  const r = runPy(COPY, { ...env, GITHUB_WORKSPACE: dir }, dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /symlink/);
  assert.equal(existsSync(join(outside, 'a.md')), false);
});

test('commit step fails if a file from the ZIP would be silently dropped by .gitignore', { skip: !HAS_PY || !HAS_GIT }, () => {
  const { dir, git } = gitRepo({ '.gitignore': 'ignored.txt\n' });
  const { tmp, env } = sandbox();
  writeFileSync(join(dir, 'ignored.txt'), 'x');
  writeFileSync(join(dir, 'kept.txt'), 'x');
  git('add', '-A');
  writeFileSync(join(tmp, 'expected.json'), JSON.stringify(['kept.txt', 'ignored.txt']));
  const bad = runPy(TRACKED, env, dir);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /ignored\.txt/);
  writeFileSync(join(tmp, 'expected.json'), JSON.stringify(['kept.txt']));
  assert.equal(runPy(TRACKED, env, dir).status, 0);
});
