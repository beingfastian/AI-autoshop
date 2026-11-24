import type { NextConfig } from 'next';

// The browser only ever talks to this site: /api/* is forwarded to the API server. That keeps the
// session cookie first-party (SameSite works as intended) and avoids CORS entirely.
const API_URL = process.env.API_URL || 'http://localhost:3001';

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
  poweredByHeader: false
};

export default nextConfig;
