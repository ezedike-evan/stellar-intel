import { z } from 'zod';
import { STELLAR_PUBKEY_PATTERN } from './patterns';

export const envSchema = z.object({
  NEXT_PUBLIC_STELLAR_NETWORK: z.enum(['mainnet', 'testnet', 'futurenet'], {
    error: () => ({ message: 'Must be one of: mainnet, testnet, futurenet' }),
  }),
  NEXT_PUBLIC_HORIZON_URL: z.string().url({
    message: 'Must be a valid URL (e.g. https://horizon.stellar.org)',
  }),
  NEXT_PUBLIC_USDC_ISSUER: z.string().regex(STELLAR_PUBKEY_PATTERN, {
    message: 'Must be a valid Stellar public key (starts with G, 56 characters)',
  }),
  NEXT_PUBLIC_APP_NAME: z.string().min(1, { message: 'Cannot be empty' }),
  NEXT_PUBLIC_STELLAR_EXPERT_URL: z
    .string()
    .url()
    .optional()
    .default('https://api.stellar.expert/explorer/public'),
  // Defaults to first-match, matching .env.example's "Keep on first-match until
  // the scored strategy is validated in staging". The code default said
  // 'scored', so the documented default and the actual one disagreed — and now
  // that the intent API honours this flag (#790), scored also puts a live rate
  // fan-out on the intent request path. Opting in stays one env var.
  ROUTING_STRATEGY: z.enum(['first-match', 'scored']).default('first-match'),
  FEE_BUDGET_PCT: z.preprocess(
    (value) => {
      if (value === undefined || value === null) return '100';
      return String(value).trim();
    },
    z
      .string()
      .regex(/^[0-9]+(?:\.[0-9]+)?$/, {
        message: 'Must be a non-negative percentage (e.g. 1 or 0.5)',
      })
      .transform(Number)
  ),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(): Env {
  const result = envSchema.safeParse({
    NEXT_PUBLIC_STELLAR_NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
    NEXT_PUBLIC_HORIZON_URL: process.env.NEXT_PUBLIC_HORIZON_URL,
    NEXT_PUBLIC_USDC_ISSUER: process.env.NEXT_PUBLIC_USDC_ISSUER,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_STELLAR_EXPERT_URL: process.env.NEXT_PUBLIC_STELLAR_EXPERT_URL,
    ROUTING_STRATEGY: process.env.ROUTING_STRATEGY,
    FEE_BUDGET_PCT: process.env.FEE_BUDGET_PCT,
  });

  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  ${String(issue.path[0])}: ${issue.message}`
    );
    throw new Error(
      `❌ Invalid environment variables:\n${lines.join('\n')}\n\nCheck your .env.local file.`
    );
  }

  return result.data;
}

export const env = parseEnv();
