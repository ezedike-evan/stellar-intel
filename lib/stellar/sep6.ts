import { Sep6NotSupportedError } from './errors';

/**
 * SEP-6 is the programmatic (non-interactive) transfer API. Unlike SEP-24
 * (which advertises TRANSFER_SERVER_SEP0024 and drives an interactive popup),
 * SEP-6 anchors advertise a plain `TRANSFER_SERVER` in their stellar.toml.
 *
 * This module mirrors the structure of {@link file://./sep24.ts} but targets
 * that programmatic API. It is intentionally network-free: it only inspects an
 * already-resolved stellar.toml and exposes typed capability detection.
 */

/**
 * Minimal view of a resolved stellar.toml needed for SEP-6 capability
 * detection. `TRANSFER_SERVER` is the SEP-6 base URL; `domain` is used only to
 * build a descriptive error message.
 *
 * The shape is structural so a full {@link Sep1TomlData} (which omits the
 * SEP-6-specific `TRANSFER_SERVER` key) can be passed without a cast — it simply
 * reports the anchor as non-SEP-6.
 */
export interface Sep6CapableToml {
  domain?: string;
  TRANSFER_SERVER?: string | null;
}

/**
 * Returns true when the anchor advertises a usable SEP-6 `TRANSFER_SERVER`.
 * A blank or whitespace-only value is treated as absent.
 */
export function hasSep6(toml: Sep6CapableToml): boolean {
  return typeof toml.TRANSFER_SERVER === 'string' && toml.TRANSFER_SERVER.trim().length > 0;
}

/**
 * Returns the anchor's SEP-6 transfer server URL.
 *
 * Throws a typed {@link Sep6NotSupportedError} when the anchor does not
 * advertise a `TRANSFER_SERVER`, mirroring `assertSep38Capable` in
 * {@link file://./sep38.ts}.
 */
export function getSep6TransferServer(toml: Sep6CapableToml): string {
  if (!hasSep6(toml)) {
    throw new Sep6NotSupportedError(toml.domain ?? 'unknown');
  }
  return (toml.TRANSFER_SERVER as string).trim();
}
