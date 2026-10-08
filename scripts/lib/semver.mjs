// Minimal strict semver helpers (no dependencies). Only plain MAJOR.MINOR.PATCH is considered "stable".
export const STABLE = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseStable(v) {
  const m = STABLE.exec(String(v ?? ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** @returns -1 | 0 | 1, or null when either side is not a plain stable version */
export function compareStable(a, b) {
  const pa = parseStable(a);
  const pb = parseStable(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}
