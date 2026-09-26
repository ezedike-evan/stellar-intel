import type { NextConfig } from 'next';
import './lib/env';

const nextConfig: NextConfig = {
  // `graphql` loads from node_modules at runtime rather than being bundled. It
  // must exist as a single instance — its `instanceof` checks fail across
  // duplicated module realms, and bundling is how duplicates appear.
  // graphql-yoga is no longer a dependency; see app/api/graphql/route.ts.
  serverExternalPackages: ['graphql'],
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
