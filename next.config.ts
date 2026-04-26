import type { NextConfig } from 'next';

// Validate all NEXT_PUBLIC_* env vars at build time.
// A missing or malformed variable throws immediately, failing the build with a
// clear message that names the offending key — no silent mis-deploys.
import './lib/env';

const nextConfig: NextConfig = {};

export default nextConfig;
