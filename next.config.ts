import type { NextConfig } from 'next';
import './lib/env';

const nextConfig: NextConfig = {
  // graphql and graphql-yoga are loaded from node_modules at runtime instead of
  // being bundled into the serverless function. `graphql` in particular must
  // exist as a single instance — its `instanceof` checks fail across duplicated
  // module realms, and bundling is how duplicates appear. The deployed
  // /api/graphql returned an empty-bodied 500 (a function dying during module
  // evaluation) while every other route on the same deployment was healthy and
  // the same commit served GraphQL correctly under a local `next start`.
  serverExternalPackages: ['graphql', 'graphql-yoga'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 86400,
  },
};

export default nextConfig;
