'use client';
import { VISIBLE_CORRIDORS } from '@/constants/anchors';
import type { Corridor } from '@/types';

interface AssetSelectorProps {
  value: string;
  onChange: (assetCode: string) => void;
  corridors?: Corridor[];
}

/**
 * Dropdown for selecting a source (sold) asset ahead of the corridor picker.
 * Options are the distinct `from` assets across the given corridors, in first-
 * seen order. The off-ramp page passes VISIBLE_CORRIDORS and switches to the
 * first visible corridor of the newly picked asset.
 */
export function AssetSelector({ value, onChange, corridors = VISIBLE_CORRIDORS }: AssetSelectorProps) {
  const assetCodes = [...new Set(corridors.map((c) => c.from))];

  return (
    <div>
      <label
        htmlFor="asset-select"
        className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-secondary-text"
      >
        Asset
        <kbd className="rounded border border-control-border px-1 font-mono text-[10px] font-normal text-secondary-text">
          A
        </kbd>
      </label>
      <select
        id="asset-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-control-border bg-bg-subtle px-3 py-2.5 text-sm text-primary-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      >
        {assetCodes.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
    </div>
  );
}
