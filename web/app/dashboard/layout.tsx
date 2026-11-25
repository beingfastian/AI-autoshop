import type { Metadata } from 'next';
import { Shell } from '@/components/Shell';

export const metadata: Metadata = { title: 'Shop dashboard', robots: { index: false } };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}
