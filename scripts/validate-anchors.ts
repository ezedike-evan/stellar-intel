/* eslint-disable no-console */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { StellarToml } from '@stellar/stellar-sdk';
import type { Anchor } from '../types';

const REPORT_PATH = path.resolve(process.cwd(), 'tests/reports/anchor-health.json');
const STELLAR_TOML_PATH = '/.well-known/stellar.toml';
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;
const DEFAULT_ENV = {
  NEXT_PUBLIC_STELLAR_NETWORK: 'mainnet',
  NEXT_PUBLIC_HORIZON_URL: 'https://horizon.stellar.org',
  NEXT_PUBLIC_USDC_ISSUER: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  NEXT_PUBLIC_APP_NAME: 'Stellar Intel',
} as const;

type TomlRecord = Record<string, unknown>;

interface AnchorCapabilities {
  hasTransferServerSep0024: boolean;
  hasTransferServerSep0006: boolean;
  hasWebAuthEndpoint: boolean;
  hasSigningKey: boolean;
  listsRegisteredAsset: boolean | null;
}

interface AnchorEndpoints {
  transferServerSep0024: string | null;
  transferServerSep0006: string | null;
  webAuthEndpoint: string | null;
}

interface AnchorHealth {
  id: string;
  name: string;
  homeDomain: string;
  tomlUrl: string;
  status: 'reachable' | 'unreachable';
  checkedAt: string;
  responseTimeMs: number;
  attempts: number;
  capabilities: AnchorCapabilities;
  endpoints: AnchorEndpoints;
  currencies: string[];
  error: string | null;
}

interface AnchorHealthReport {
  schemaVersion: 1;
  generatedAt: string;
  summary: {
    total: number;
    reachable: number;
    unreachable: number;
  };
  anchors: AnchorHealth[];
}

function ensureConfigDefaults(): void {
  for (const [key, value] of Object.entries(DEFAULT_ENV)) {
    process.env[key] ??= value;
  }
}

async function loadAnchors(): Promise<Anchor[]> {
  ensureConfigDefaults();

  const registry =
    (await import('../lib/stellar/anchors')) as typeof import('../lib/stellar/anchors');
  return [...registry.ANCHORS];
}

function getStringField(toml: TomlRecord, key: string): string | null {
  const value = toml[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function isRecord(value: unknown): value is TomlRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getCurrencies(toml: TomlRecord): TomlRecord[] {
  const currencies = toml['CURRENCIES'];
  return Array.isArray(currencies) ? currencies.filter(isRecord) : [];
}

function getCurrencyCodes(currencies: TomlRecord[]): string[] {
  return currencies
    .map((currency) => currency['code'])
    .filter((code): code is string => typeof code === 'string' && code.length > 0);
}

function listsRegisteredAsset(anchor: Anchor, currencies: TomlRecord[]): boolean | null {
  if (currencies.length === 0) {
    return null;
  }

  return currencies.some((currency) => {
    const code = currency['code'];
    const issuer = currency['issuer'];

    return code === anchor.assetCode && issuer === anchor.assetIssuer;
  });
}

function buildCapabilities(
  anchor: Anchor,
  toml: TomlRecord
): {
  capabilities: AnchorCapabilities;
  endpoints: AnchorEndpoints;
  currencies: string[];
} {
  const transferServerSep0024 = getStringField(toml, 'TRANSFER_SERVER_SEP0024');
  const transferServerSep0006 = getStringField(toml, 'TRANSFER_SERVER');
  const webAuthEndpoint = getStringField(toml, 'WEB_AUTH_ENDPOINT');
  const signingKey = getStringField(toml, 'SIGNING_KEY');
  const currencies = getCurrencies(toml);

  return {
    capabilities: {
      hasTransferServerSep0024: transferServerSep0024 !== null,
      hasTransferServerSep0006: transferServerSep0006 !== null,
      hasWebAuthEndpoint: webAuthEndpoint !== null,
      hasSigningKey: signingKey !== null,
      listsRegisteredAsset: listsRegisteredAsset(anchor, currencies),
    },
    endpoints: {
      transferServerSep0024,
      transferServerSep0006,
      webAuthEndpoint,
    },
    currencies: getCurrencyCodes(currencies),
  };
}

function emptyCapabilities(): {
  capabilities: AnchorCapabilities;
  endpoints: AnchorEndpoints;
  currencies: string[];
} {
  return {
    capabilities: {
      hasTransferServerSep0024: false,
      hasTransferServerSep0006: false,
      hasWebAuthEndpoint: false,
      hasSigningKey: false,
      listsRegisteredAsset: null,
    },
    endpoints: {
      transferServerSep0024: null,
      transferServerSep0006: null,
      webAuthEndpoint: null,
    },
    currencies: [],
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function resolveTomlWithRetry(
  domain: string
): Promise<{ toml: TomlRecord; attempts: number }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const toml = (await StellarToml.Resolver.resolve(domain)) as TomlRecord;
      return { toml, attempts: attempt };
    } catch (error) {
      lastError = error;

      if (attempt < MAX_ATTEMPTS) {
        await delay(RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw lastError;
}

async function validateAnchor(anchor: Anchor): Promise<AnchorHealth> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const tomlUrl = `https://${anchor.homeDomain}${STELLAR_TOML_PATH}`;

  try {
    const { toml, attempts } = await resolveTomlWithRetry(anchor.homeDomain);
    const capabilityReport = buildCapabilities(anchor, toml);

    return {
      id: anchor.id,
      name: anchor.name,
      homeDomain: anchor.homeDomain,
      tomlUrl,
      status: 'reachable',
      checkedAt,
      responseTimeMs: Date.now() - startedAt,
      attempts,
      ...capabilityReport,
      error: null,
    };
  } catch (error) {
    return {
      id: anchor.id,
      name: anchor.name,
      homeDomain: anchor.homeDomain,
      tomlUrl,
      status: 'unreachable',
      checkedAt,
      responseTimeMs: Date.now() - startedAt,
      attempts: MAX_ATTEMPTS,
      ...emptyCapabilities(),
      error: formatError(error),
    };
  }
}

function buildReport(anchors: AnchorHealth[]): AnchorHealthReport {
  const unreachable = anchors.filter((anchor) => anchor.status === 'unreachable').length;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: {
      total: anchors.length,
      reachable: anchors.length - unreachable,
      unreachable,
    },
    anchors,
  };
}

async function writeReport(report: AnchorHealthReport): Promise<void> {
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  const anchors = await loadAnchors();
  const results = await Promise.all(anchors.map(validateAnchor));
  const report = buildReport(results);

  await writeReport(report);

  if (report.summary.unreachable > 0) {
    console.error(
      `[validate:anchors] ${report.summary.unreachable}/${report.summary.total} anchor TOML files are unreachable. Report written to ${REPORT_PATH}.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[validate:anchors] ${report.summary.reachable}/${report.summary.total} anchor TOML files resolved. Report written to ${REPORT_PATH}.`
  );
}

void main().catch((error: unknown) => {
  console.error(`[validate:anchors] ${formatError(error)}`);
  process.exitCode = 1;
});
