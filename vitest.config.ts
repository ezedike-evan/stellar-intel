import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    env: {
      NEXT_PUBLIC_STELLAR_NETWORK: 'mainnet',
      NEXT_PUBLIC_HORIZON_URL: 'https://horizon.stellar.org',
      NEXT_PUBLIC_USDC_ISSUER: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      NEXT_PUBLIC_APP_NAME: 'Stellar Intel',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
