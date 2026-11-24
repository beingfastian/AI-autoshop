import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { BRAND_NAME, BRAND_TAGLINE } from '@/lib/brand';
import './globals.css';

// Self-hosted by Next at build time: no request to Google from visitors, no layout jump
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap' });

export const metadata: Metadata = {
  title: { default: `Shop dashboard · ${BRAND_NAME}`, template: `%s · ${BRAND_NAME}` },
  description: `${BRAND_NAME}: ${BRAND_TAGLINE}. Calls, bookings and settings for your shop.`
};

export const viewport: Viewport = { themeColor: '#2563eb' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body className="min-h-screen font-sans text-[15px] antialiased">{children}</body>
    </html>
  );
}
