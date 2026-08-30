/**
 * JSON-LD structured data generators for SEO.
 * Emits schema.org Organization, WebSite, and Dataset schemas for root attribution,
 * search engine indexing, and dataset discoverability.
 */

export const DEFAULT_SITE_URL = 'https://stellar-intel.vercel.app';
export const GITHUB_ORG_URL = 'https://github.com/ezedike-evan';
export const GITHUB_REPO_URL = 'https://github.com/ezedike-evan/stellar-intel';
export const DISCORD_URL = 'https://discord.gg/stellar';

export const JSONLD_MIN_SUFFICIENT_SAMPLES = 288; // 24h at 5-minute intervals

export interface OrganizationSchema {
  '@context': 'https://schema.org';
  '@type': 'Organization';
  name: string;
  url: string;
  logo: string;
  description: string;
  sameAs: string[];
}

export interface WebSiteSchema {
  '@context': 'https://schema.org';
  '@type': 'WebSite';
  name: string;
  url: string;
  description: string;
  publisher: {
    '@type': 'Organization';
    name: string;
    url: string;
  };
  potentialAction: {
    '@type': 'SearchAction';
    target: {
      '@type': 'EntryPoint';
      urlTemplate: string;
    };
    'query-input': string;
  };
}

export interface DatasetJsonLdOptions {
  url: string;
  name: string;
  description: string;
  temporalCoverage: string | null;
  totalSamples: number;
  updateFrequency: string;
  license: string;
  dateModified: string;
}

export interface DatasetSchema {
  '@context': 'https://schema.org';
  '@type': 'Dataset';
  name: string;
  description: string;
  url: string;
  license: string;
  dateModified: string;
  updateFrequency: string;
  measurementTechnique: string;
  variableMeasured: string[];
  distribution: Array<{
    '@type': 'DataDownload';
    encodingFormat: string;
    contentUrl: string;
  }>;
  temporalCoverage?: string;
}

export function getOrganizationJsonLd(siteUrl: string = DEFAULT_SITE_URL): OrganizationSchema {
  const url = siteUrl.replace(/\/+$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Stellar Intel',
    url,
    logo: `${url}/favicons/icon-512x512.png`,
    description:
      'A public health record for Stellar off-ramp anchors — probing uptime, quote availability, issuer mismatch, and TOML integrity.',
    sameAs: [GITHUB_ORG_URL, GITHUB_REPO_URL, DISCORD_URL],
  };
}

export function getWebSiteJsonLd(siteUrl: string = DEFAULT_SITE_URL): WebSiteSchema {
  const url = siteUrl.replace(/\/+$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Stellar Intel',
    url,
    description:
      'Every registered Stellar off-ramp anchor, probed every five minutes across four signals — uptime, quote availability, issuer mismatch, TOML integrity.',
    publisher: {
      '@type': 'Organization',
      name: 'Stellar Intel',
      url,
    },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${url}/anchors?search={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function getRootJsonLd(siteUrl: string = DEFAULT_SITE_URL) {
  return {
    '@context': 'https://schema.org',
    '@graph': [getOrganizationJsonLd(siteUrl), getWebSiteJsonLd(siteUrl)],
  };
}

export function buildDatasetJsonLd(options: DatasetJsonLdOptions): DatasetSchema {
  let description = options.description;
  if (options.totalSamples < JSONLD_MIN_SUFFICIENT_SAMPLES) {
    const sampleText = options.totalSamples === 1 ? '1 sample recorded' : `${options.totalSamples} samples recorded`;
    description = `[Preliminary — insufficient sample history (${sampleText})] ${description}`;
  }

  const schema: DatasetSchema = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: options.name,
    description,
    url: options.url,
    license: options.license,
    dateModified: options.dateModified,
    updateFrequency: options.updateFrequency,
    measurementTechnique: 'Composite reliability score across uptime, SEP-38 quote availability, and TOML validation.',
    variableMeasured: ['reliabilityScore', 'uptimePercentage', 'quoteSuccessRate', 'tomlValidationStatus'],
    distribution: [
      {
        '@type': 'DataDownload',
        encodingFormat: 'application/json',
        contentUrl: `${options.url}/export.json`,
      },
    ],
  };

  if (options.temporalCoverage) {
    schema.temporalCoverage = options.temporalCoverage;
  }

  return schema;
}

/**
 * Safely serialize JSON-LD object to string, escaping '<' to prevent script injection.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
