import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: [],
    env: {
      NEXT_PUBLIC_STELLAR_NETWORK: 'testnet',
      NEXT_PUBLIC_HORIZON_URL: 'https://horizon-testnet.stellar.org',
      NEXT_PUBLIC_USDC_ISSUER: 'GBBD47UZQ2BNPGJ5DLAYK2DG6V6GES7Q6YLVN3XZNPXXIGMWR5MPNUPZ',
      NEXT_PUBLIC_APP_NAME: 'Stellar Intel Test',
      ADMIN_SECRET_KEY: 'test_admin_key',
      ORACLE_CONTRACT_ID: 'test_oracle_contract',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
})



