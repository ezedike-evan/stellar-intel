import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LISTED_DIR_URL = new URL('../../constants/listed-anchors', import.meta.url);
const DEFAULT_DIR =
  LISTED_DIR_URL.protocol === 'file:'
    ? fileURLToPath(LISTED_DIR_URL)
    : resolve(process.cwd(), 'constants/listed-anchors');

/**
 * Read every *.json file in `dir`, parse each, and return the array sorted by file name.
 * Throws an error naming the file if JSON is invalid.
 *
 * @param {{ dir?: string }} [options]
 * @returns {Array<Record<string, any>>}
 */
export function readListedAnchors({ dir = DEFAULT_DIR } = {}) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const entries = [];
  for (const file of files) {
    const fullPath = resolve(dir, file);
    const content = readFileSync(fullPath, 'utf8');
    try {
      entries.push(JSON.parse(content));
    } catch (e) {
      throw new Error(`Failed to parse ${file}: ${e.message}`);
    }
  }
  return entries;
}

/**
 * Read listed-operator domains and return domain candidates with sources.
 *
 * @param {{ dir?: string }} [options]
 * @returns {Array<{ domain: string, sources: string[] }>}
 */
export function readListedDomains({ dir = DEFAULT_DIR } = {}) {
  const entries = readListedAnchors({ dir });
  const byDomain = new Map();
  for (const entry of entries) {
    const id = entry.id;
    for (const d of entry.domains ?? []) {
      const domain = String(d).toLowerCase();
      if (!byDomain.has(domain)) {
        byDomain.set(domain, []);
      }
      byDomain.get(domain).push(`listed:${id}`);
    }
  }
  const result = [];
  for (const [domain, sources] of byDomain.entries()) {
    result.push({ domain, sources });
  }
  result.sort((a, b) => a.domain.localeCompare(b.domain));
  return result;
}
