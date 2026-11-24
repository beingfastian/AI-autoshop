import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Receptionist · Shop dashboard',
  description: 'Calls, bookings and settings for auto repair shops using the AI phone receptionist'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
