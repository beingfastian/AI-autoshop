import type { NextConfig } from 'next';

// The browser only ever talks to this site: /api/* is forwarded to the API server. That keeps the
// session cookie first-party (SameSite works as intended) and avoids CORS entirely.
// Note: rewrites are fixed at BUILD time. Set API_URL before `next build` (on Vercel: as a project
// environment variable); changing it later needs a rebuild, not just a restart.
const API_URL = process.env.API_URL || 'http://localhost:3001';

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
  poweredByHeader: false
};

export default nextConfig;
