'use client';

// Dashboard frame: loads the signed-in user once, shares it (and the shop's timezone) with every
// page, and renders the navigation.
import { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api, type Me } from '@/lib/api';
import { ErrorBox, Loading } from './ui';

const MeContext = createContext<Me | null>(null);

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe must be used inside <Shell>');
  return me;
}

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/calls', label: 'Calls' },
  { href: '/bookings', label: 'Bookings' },
  { href: '/settings', label: 'Settings' }
];

export function Shell({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    api<Me>('/auth/me').then(setMe).catch((e) => setError(e.message));
  }, []);

  async function signOut() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    router.replace('/login');
  }

  if (error) return <main className="mx-auto max-w-lg p-8"><ErrorBox error={error} onRetry={() => location.reload()} /></main>;
  if (!me) return <Loading />;

  const active = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <MeContext.Provider value={me}>
      <div className="min-h-screen md:flex">
        <aside className="border-b border-gray-200 bg-white md:min-h-screen md:w-60 md:border-b-0 md:border-r">
          <div className="flex items-center gap-2 px-5 py-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">☎</div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{me.workshop.name}</p>
              <p className="text-xs text-gray-500">AI Receptionist</p>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active(item.href) ? 'page' : undefined}
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${active(item.href) ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="hidden border-t border-gray-100 px-5 py-4 md:mt-6 md:block">
            <p className="truncate text-sm font-medium">{me.user.full_name}</p>
            <p className="truncate text-xs text-gray-500">{me.user.email} · {me.user.role}</p>
            <button onClick={signOut} className="mt-3 text-sm font-medium text-gray-600 hover:text-gray-900">Sign out</button>
          </div>
        </aside>
        <main className="flex-1 px-4 py-6 md:px-10 md:py-8">
          <div className="mx-auto max-w-6xl">{children}</div>
          <button onClick={signOut} className="mt-10 text-sm text-gray-500 md:hidden">Sign out</button>
        </main>
      </div>
    </MeContext.Provider>
  );
}
