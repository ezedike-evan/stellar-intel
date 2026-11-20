import { ANCHORS } from '@/constants/anchors';
import type { Anchor, Sep1TomlData, Sep38Info } from '@/types';
import { resolveAnchor } from './sep1';
import { getSep38Info } from './sep38';

/**
 * Whether an anchor is ready to give firm (SEP-38) quotes, from live data: does
 * its stellar.toml advertise a quote server, does that server's /info answer, and
 * does it list the asset the anchor is registered for. Side-effect free, apart from
 * the two reads.
 */
export interface Sep38Readiness {
  anchorId: string;
  /** The operator says the anchor supports SEP-38 (`anchor.seps` includes 'sep38'). */
  declared: boolean;
  /** `ANCHOR_QUOTE_SERVER` from the anchor's stellar.toml; null when not advertised. */
  quoteServer: string | null;
  /** The quote server's /info returned a valid answer. */
  infoReachable: boolean;
  /** SEP-38 asset identifiers the quote server lists. */
  assets: string[];
  /** `assets` includes `stellar:<assetCode>:<assetIssuer>` for the anchor's registered asset. */
  sellsRegisteredAsset: boolean;
  /** Why the check could not finish, when it could not. */
  error: string | null;
  /** ISO 8601 time of the check. */
  checkedAt: string;
}

export interface Sep38ReadinessDeps {
  resolveToml?: (domain: string) => Promise<Pick<Sep1TomlData, 'ANCHOR_QUOTE_SERVER'>>;
  getInfo?: (quoteServer: string) => Promise<Sep38Info>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Never throws: every failure is reported through `error`. */
export async function getSep38Readiness(
  anchor: Anchor,
  deps: Sep38ReadinessDeps = {}
): Promise<Sep38Readiness> {
  const resolveToml = deps.resolveToml ?? resolveAnchor;
  const getInfo = deps.getInfo ?? getSep38Info;

  const result: Sep38Readiness = {
    anchorId: anchor.id,
    declared: anchor.seps?.includes('sep38') ?? false,
    quoteServer: null,
    infoReachable: false,
    assets: [],
    sellsRegisteredAsset: false,
    error: null,
    checkedAt: new Date().toISOString(),
  };

  try {
    const toml = await resolveToml(anchor.serviceDomain ?? anchor.homeDomain);
    result.quoteServer = toml.ANCHOR_QUOTE_SERVER?.trim() || null;
  } catch (err) {
    result.error = `stellar.toml: ${errorMessage(err)}`;
    return result;
  }

  if (!result.quoteServer) return result;

  try {
    const info = await getInfo(result.quoteServer);
    result.infoReachable = true;
    result.assets = info.assets.map((a) => a.asset);
    result.sellsRegisteredAsset = result.assets.includes(
      `stellar:${anchor.assetCode}:${anchor.assetIssuer}`
    );
  } catch (err) {
    result.error = `SEP-38 /info: ${errorMessage(err)}`;
  }

  return result;
}

/** The readiness of every registered anchor, checked concurrently. */
export function getAllSep38Readiness(deps: Sep38ReadinessDeps = {}): Promise<Sep38Readiness[]> {
  return Promise.all(ANCHORS.map((anchor) => getSep38Readiness(anchor, deps)));
}
