import { CORRIDORS } from '@/constants';

/**
 * Convert an ISO 3166-1 alpha-2 country code to its flag emoji by mapping each
 * letter to its regional indicator symbol. Returns an empty string for codes
 * that are not exactly two ASCII letters.
 */
function flagEmoji(countryCode: string): string {
  const code = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) {
    return '';
  }
  const base = 0x1f1e6; // Regional Indicator Symbol Letter A
  const a = 'A'.charCodeAt(0);
  return String.fromCodePoint(base + (code.charCodeAt(0) - a), base + (code.charCodeAt(1) - a));
}

/**
 * Landing strip of supported off-ramp corridors, shown as country flag +
 * destination currency chips.
 *
 * Derived from CORRIDORS and deduplicated by destination (country + currency),
 * since multiple corridors can share the same destination. Wraps responsively.
 */
export function CorridorStrip() {
  const seen = new Set<string>();
  const destinations = CORRIDORS.filter((corridor) => {
    const key = `${corridor.countryCode}-${corridor.to}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return (
    <section aria-label="Supported corridors">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Supported corridors
      </p>
      <ul className="flex flex-wrap gap-2">
        {destinations.map((corridor) => (
          <li
            key={corridor.id}
            className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
          >
            <span aria-hidden="true" className="text-base leading-none">
              {flagEmoji(corridor.countryCode)}
            </span>
            <span>{corridor.to}</span>
            <span className="sr-only">{corridor.countryName}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
