'use client';
import { CORRIDORS } from '@/lib/stellar/anchors';

const COUNTRY_FLAGS: Record<string, string> = {
  // Africa
  NG: '🇳🇬',
  KE: '🇰🇪',
  GH: '🇬🇭',
  UG: '🇺🇬',
  TZ: '🇹🇿',
  SN: '🇸🇳',
  ZA: '🇿🇦',
  // Latin America
  MX: '🇲🇽',
  BR: '🇧🇷',
  AR: '🇦🇷',
  PE: '🇵🇪',
  CO: '🇨🇴',
  CL: '🇨🇱',
  // Southeast Asia
  PH: '🇵🇭',
  ID: '🇮🇩',
  VN: '🇻🇳',
  TH: '🇹🇭',
  // South Asia
  IN: '🇮🇳',
  PK: '🇵🇰',
  // Europe
  DE: '🇩🇪',
};

interface CorridorSelectorProps {
  value: string;
  onChange: (corridorId: string) => void;
}

/**
 * Dropdown for selecting an off-ramp corridor.
 * Defaults to usdc-ngn (Nigeria) as the first option.
 */
export function CorridorSelector({ value, onChange }: CorridorSelectorProps) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
        Corridor
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
      >
        {CORRIDORS.map((c) => (
          <option key={c.id} value={c.id}>
            {COUNTRY_FLAGS[c.countryCode] ?? ''} {c.countryName} ({c.to})
          </option>
        ))}
      </select>
    </div>
  );
}
