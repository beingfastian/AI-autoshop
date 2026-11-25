import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { BRAND_NAME, BRAND_TAGLINE } from '@/lib/brand';
import './globals.css';

// Self-hosted by Next at build time: no request to Google from visitors, no layout jump
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap' });

// Absolute URLs for social previews: Vercel provides the production domain at build time
const site = process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000');

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: `${BRAND_NAME} · ${BRAND_TAGLINE}`, template: `%s · ${BRAND_NAME}` },
  description: `${BRAND_NAME} answers your shop's phone, books jobs into the slots you actually have open, and hands you a short list of people to call back.`
};

export const viewport: Viewport = { themeColor: '#2563eb' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body className="min-h-screen font-sans text-[15px] antialiased">{children}</body>
    </html>
  );
}
