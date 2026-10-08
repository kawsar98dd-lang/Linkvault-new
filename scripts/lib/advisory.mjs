import { compareStable } from './semver.mjs';

/** Hard floor independent of any advisory database (2FA/session-caching vulnerability fixed in 1.4.9). */
export const BETTER_AUTH_MIN_VERSION = '1.4.9';

/**
 * Fail-closed policy check on the pinned version string itself.
 * @returns {string | null} an error message, or null when acceptable
 */
export function checkVersionPolicy(version, floor = BETTER_AUTH_MIN_VERSION) {
  if (!version) return 'better-auth is not pinned in the pnpm catalog';
  if (/unresolved/i.test(version)) return 'better-auth version is UNRESOLVED: run the generate-lockfile workflow to resolve and verify the current stable version';
  const cmp = compareStable(version, floor);
  if (cmp === null) return `better-auth must be pinned to an exact stable MAJOR.MINOR.PATCH version (got "${version}")`;
  if (cmp < 0) return `better-auth@${version} is below the security floor ${floor}`;
  return null;
}

// Evaluates an OSV.dev response for a pinned package version.
export function evaluateOsv(response) {
  const vulns = Array.isArray(response?.vulns) ? response.vulns : [];
  const result = { blocking: [], warnings: [] };
  for (const v of vulns) {
    const sev = String(v?.database_specific?.severity ?? 'UNKNOWN').toUpperCase();
    const fixed = (v.affected ?? []).flatMap((a) => (a.ranges ?? []).flatMap((r) => (r.events ?? []).filter((e) => e.fixed).map((e) => e.fixed)));
    const item = { id: v.id, severity: sev, summary: v.summary ?? '', fixed };
    if (sev === 'CRITICAL' || sev === 'HIGH' || sev === 'UNKNOWN') result.blocking.push(item);
    else result.warnings.push(item);
  }
  return result;
}

export function pinnedVersion(workspaceYaml, pkg) {
  const re = new RegExp(`^\\s*"?${pkg.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"?:\\s*([0-9][^\\s#]*)`, 'm');
  return re.exec(workspaceYaml)?.[1] ?? null;
}
