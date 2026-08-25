import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The workspace packages ship raw TypeScript rather than a build artifact,
  // so Next compiles them alongside the app. This is also what keeps the
  // engine consumable unchanged by a React Native bundler in v2.
  transpilePackages: ['@poker/engine', '@poker/content'],
};

export default nextConfig;
