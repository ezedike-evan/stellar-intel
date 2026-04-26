import type { Country, StellarAsset, Anchor } from '@/types';

export const STELLAR_NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'mainnet';
export const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL ?? 'https://horizon.stellar.org';
export const STELLAR_EXPERT_URL =
  process.env.NEXT_PUBLIC_STELLAR_EXPERT_URL ?? 'https://api.stellar.expert/explorer/public';

export const USDC_ASSET: StellarAsset = {
  code: 'USDC',
  issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  name: 'USD Coin',
};

export const XLM_ASSET: StellarAsset = {
  code: 'XLM',
  name: 'Stellar Lumens',
};

export const EURC_ASSET: StellarAsset = {
  code: 'EURC',
  issuer: 'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP',
  name: 'Euro Coin',
};

export const USDY_ASSET: StellarAsset = {
  code: 'USDY',
  issuer: 'GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV5YBGGXWWLP',
  name: 'Ondo US Dollar Yield',
};

export const SUPPORTED_ASSETS: StellarAsset[] = [USDC_ASSET, XLM_ASSET, EURC_ASSET, USDY_ASSET];

export const SUPPORTED_COUNTRIES: Country[] = [
  { code: 'NG', name: 'Nigeria', currency: 'NGN', currencySymbol: '₦', flag: '🇳🇬' },
  { code: 'KE', name: 'Kenya', currency: 'KES', currencySymbol: 'KSh', flag: '🇰🇪' },
  { code: 'GH', name: 'Ghana', currency: 'GHS', currencySymbol: 'GH₵', flag: '🇬🇭' },
  { code: 'PH', name: 'Philippines', currency: 'PHP', currencySymbol: '₱', flag: '🇵🇭' },
  { code: 'MX', name: 'Mexico', currency: 'MXN', currencySymbol: '$', flag: '🇲🇽' },
  { code: 'BR', name: 'Brazil', currency: 'BRL', currencySymbol: 'R$', flag: '🇧🇷' },
  { code: 'DE', name: 'Germany', currency: 'EUR', currencySymbol: '€', flag: '🇩🇪' },
];

export const KNOWN_ANCHORS: Anchor[] = [
  {
    id: 'bitso',
    name: 'Bitso',
    homeDomain: 'bitso.com',
    corridors: ['usdc-mxn', 'usdc-brl'],
    assetCode: 'USDC',
    assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  },
  {
    id: 'flutterwave',
    name: 'Flutterwave',
    homeDomain: 'flutterwave.com',
    corridors: ['usdc-ngn', 'usdc-kes', 'usdc-ghs'],
    assetCode: 'USDC',
    assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  },
  {
    id: 'mychoice',
    name: 'MyChoice',
    homeDomain: 'mychoicefinance.com',
    corridors: ['usdc-php'],
    assetCode: 'USDC',
    assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  },
  {
    id: 'tempo',
    name: 'Tempo',
    homeDomain: 'tempo.eu.com',
    corridors: ['usdc-eur'],
    assetCode: 'USDC',
    assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  },
  {
    id: 'cowrie',
    name: 'Cowrie Exchange',
    homeDomain: 'cowrie.exchange',
    corridors: ['usdc-ngn'],
    assetCode: 'USDC',
    assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  },
];

export const REVALIDATION_INTERVAL = 30_000; // 30 seconds

export const SWAP_SOURCES = ['SDEX', 'Soroswap', 'Phoenix', 'Aquarius'] as const;
