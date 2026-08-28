import type { Country, StellarAsset } from '@/types';
export { KNOWN_ANCHORS, ANCHORS, CORRIDORS, ANCHOR_HOME_DOMAINS, registryStats } from './anchors';
export type { RegistryStats } from './anchors';

import { env } from '@/lib/env';
export const HORIZON_URL = env.NEXT_PUBLIC_HORIZON_URL;
export const STELLAR_EXPERT_URL = env.NEXT_PUBLIC_STELLAR_EXPERT_URL;
export const STELLAR_NETWORK = env.NEXT_PUBLIC_STELLAR_NETWORK;

export const USDC_ASSET: StellarAsset = {
  code: 'USDC',
  issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  name: 'USD Coin',
};

export const SUPPORTED_COUNTRIES: Country[] = [
  { code: 'NG', name: 'Nigeria', currency: 'NGN', currencySymbol: '₦', flag: '🇳🇬' },
  { code: 'KE', name: 'Kenya', currency: 'KES', currencySymbol: 'KSh', flag: '🇰🇪' },
  { code: 'GH', name: 'Ghana', currency: 'GHS', currencySymbol: 'GH₵', flag: '🇬🇭' },
  { code: 'PH', name: 'Philippines', currency: 'PHP', currencySymbol: '₱', flag: '🇵🇭' },
  { code: 'MX', name: 'Mexico', currency: 'MXN', currencySymbol: '$', flag: '🇲🇽' },
  { code: 'BR', name: 'Brazil', currency: 'BRL', currencySymbol: 'R$', flag: '🇧🇷' },
  { code: 'DE', name: 'Germany', currency: 'EUR', currencySymbol: '€', flag: '🇩🇪' },
];
