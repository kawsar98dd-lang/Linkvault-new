import { BETTER_AUTH_MIN_VERSION, checkVersionPolicy } from './advisory.mjs';
import { STABLE } from './semver.mjs';

/** Chooses the registry's `latest` dist-tag ONLY if it is an existing, non-deprecated, stable, above-floor version. */
export function chooseStable(registryDoc, floor = BETTER_AUTH_MIN_VERSION) {
  const latest = registryDoc?.['dist-tags']?.latest;
  if (typeof latest !== 'string' || !STABLE.test(latest)) throw new Error(`registry "latest" is not a plain stable version (${String(latest)})`);
  const meta = registryDoc?.versions?.[latest];
  if (!meta) throw new Error(`version ${latest} is not present in the registry version list`);
  if (meta.deprecated) throw new Error(`version ${latest} is deprecated: ${String(meta.deprecated).slice(0, 120)}`);
  const policy = checkVersionPolicy(latest, floor);
  if (policy) throw new Error(policy);
  return latest;
}

/** Rewrites the exact version of one catalog entry. Fails if the entry is missing or appears more than once. */
export function setCatalogVersion(yaml, pkg, version) {
  if (!STABLE.test(version)) throw new Error('refusing to write a non-exact version');
  const esc = pkg.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const re = new RegExp(`^(\\s*"?${esc}"?:\\s*)([0-9][^\\s#]*)(.*)$`, 'gm');
  const matches = [...yaml.matchAll(re)];
  if (matches.length !== 1) throw new Error(`expected exactly one catalog entry for ${pkg}, found ${matches.length}`);
  return yaml.replace(re, `$1${version}$3`);
}
