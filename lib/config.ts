export interface Config {
  stellarNetwork: 'mainnet' | 'testnet' | 'futurenet';
  horizonUrl: string;
  usdcIssuer: string;
  appName: string;
}

// Asset code for USDC (constant, not environment-dependent)
export const USDC_ASSET_CODE = 'USDC';

// Network passphrases for Stellar networks
const NETWORK_PASSPHRASES = {
  mainnet: 'Public Global Stellar Network ; September 2015',
  testnet: 'Test SDF Network ; September 2015',
  futurenet: 'Test SDF Future Network ; October 2022',
} as const;

function validateEnv(): void {
  const requiredVars = [
    'NEXT_PUBLIC_STELLAR_NETWORK',
    'NEXT_PUBLIC_HORIZON_URL',
    'NEXT_PUBLIC_USDC_ISSUER',
    'NEXT_PUBLIC_APP_NAME',
  ] as const;

  const missing = requiredVars.filter(
    (varName) => !process.env[varName] || process.env[varName]?.trim() === ''
  );

  if (missing.length > 0) {
    throw new Error(
      `❌ Missing required environment variables:\n` +
      missing.map(v => `   - ${v}`).join('\n') +
      `\n\nPlease check your .env.local file and ensure all variables are set.`
    );
  }

  // Additional validation for specific variable formats
  const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK;
  if (network !== 'mainnet' && network !== 'testnet' && network !== 'futurenet') {
    throw new Error(
      `❌ Invalid NEXT_PUBLIC_STELLAR_NETWORK: "${network}"\n` +
      `   Must be one of: mainnet, testnet, futurenet`
    );
  }

  const horizonUrl = process.env.NEXT_PUBLIC_HORIZON_URL!;
  try {
    new URL(horizonUrl);
  } catch {
    throw new Error(
      `❌ Invalid NEXT_PUBLIC_HORIZON_URL: "${horizonUrl}"\n` +
      `   Must be a valid URL (e.g., https://horizon.stellar.org)`
    );
  }

  const issuer = process.env.NEXT_PUBLIC_USDC_ISSUER!;
  if (!/^G[A-Z0-9]{55}$/.test(issuer)) {
    throw new Error(
      `❌ Invalid NEXT_PUBLIC_USDC_ISSUER: "${issuer}"\n` +
      `   Must be a valid Stellar public key (starts with 'G', 56 characters total)`
    );
  }
}

// Only validate on the server. In the browser, Next.js inlines NEXT_PUBLIC_*
// values at compile time so process.env is empty — validation would always fail.
if (typeof window === 'undefined') {
  validateEnv();
}

/**
 * Typed configuration object.
 * Safe to import anywhere in the application.
 */
export const config: Config = {
  stellarNetwork: process.env.NEXT_PUBLIC_STELLAR_NETWORK as Config['stellarNetwork'],
  horizonUrl: process.env.NEXT_PUBLIC_HORIZON_URL!,
  usdcIssuer: process.env.NEXT_PUBLIC_USDC_ISSUER!,
  appName: process.env.NEXT_PUBLIC_APP_NAME!,
};

// Freeze to prevent accidental mutations
Object.freeze(config);

// Individual named exports for commonly used values
export const HORIZON_URL = config.horizonUrl;
export const USDC_ISSUER = config.usdcIssuer;
export const NETWORK_PASSPHRASE = NETWORK_PASSPHRASES[config.stellarNetwork];