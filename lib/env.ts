import { z } from 'zod'

export const envSchema = z.object({
  NEXT_PUBLIC_STELLAR_NETWORK: z.enum(['mainnet', 'testnet', 'futurenet'], {
    errorMap: () => ({ message: 'Must be one of: mainnet, testnet, futurenet' }),
  }),
  NEXT_PUBLIC_HORIZON_URL: z.string().url({
    message: 'Must be a valid URL (e.g. https://horizon.stellar.org)',
  }),
  NEXT_PUBLIC_USDC_ISSUER: z.string().regex(/^G[A-Z0-9]{55}$/, {
    message: 'Must be a valid Stellar public key (starts with G, 56 characters)',
  }),
  NEXT_PUBLIC_APP_NAME: z.string().min(1, { message: 'Cannot be empty' }),
  NEXT_PUBLIC_STELLAR_EXPERT_URL: z
    .string()
    .url()
    .optional()
    .default('https://api.stellar.expert/explorer/public'),
})

export type Env = z.infer<typeof envSchema>

export function parseEnv(): Env {
  const result = envSchema.safeParse({
    NEXT_PUBLIC_STELLAR_NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
    NEXT_PUBLIC_HORIZON_URL: process.env.NEXT_PUBLIC_HORIZON_URL,
    NEXT_PUBLIC_USDC_ISSUER: process.env.NEXT_PUBLIC_USDC_ISSUER,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_STELLAR_EXPERT_URL: process.env.NEXT_PUBLIC_STELLAR_EXPERT_URL,
  })

  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  ${String(issue.path[0])}: ${issue.message}`
    )
    throw new Error(
      `❌ Invalid environment variables:\n${lines.join('\n')}\n\nCheck your .env.local file.`
    )
  }

  return result.data
}

export const env = parseEnv()
