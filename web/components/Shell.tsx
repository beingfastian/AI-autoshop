'use client';

// Dashboard frame: loads the signed-in user once, shares it (and the shop's timezone) with every
// page, and renders the sidebar (desktop) or top bar (mobile).
import { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { CalendarDays, LayoutDashboard, LogOut, PhoneCall, Settings, type LucideIcon } from 'lucide-react';
import { api, type Me } from '@/lib/api';
import { Avatar, ErrorBox, Skeleton } from './ui';
import { Logo } from './Logo';

const MeContext = createContext<Me | null>(null);

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe must be used inside <Shell>');
  return me;
}

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/calls', label: 'Calls', icon: PhoneCall },
  { href: '/bookings', label: 'Bookings', icon: CalendarDays },
  { href: '/settings', label: 'Settings', icon: Settings }
];

function NavLinks({ active, compact = false }: { active: (href: string) => boolean; compact?: boolean }) {
  return (
    <>
      {NAV.map(({ href, label, icon: Icon }) => {
        const on = active(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={on ? 'page' : undefined}
            className={`group flex rounded-xl font-medium transition-colors duration-150 ${
              compact ? 'min-h-[52px] flex-col items-center justify-center gap-1 px-1 text-xs' : 'h-11 items-center gap-3 px-3 text-[15px]'
            } ${on ? 'bg-brand-50 text-brand-700' : 'text-ink-muted hover:bg-slate-100 hover:text-ink'}`}
          >
            <Icon aria-hidden className={`h-[18px] w-[18px] ${on ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-600'}`} />
            {label}
          </Link>
        );
      })}
    </>
  );
}

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
  if (!me) {
    return (
      <div role="status" className="flex min-h-screen">
        <span className="sr-only">Loading your dashboard…</span>
        <div className="hidden w-64 border-r border-line bg-white p-5 lg:block"><Skeleton className="h-9 w-40" /></div>
        <div className="flex-1 space-y-4 p-10"><Skeleton className="h-8 w-56" /><Skeleton className="h-28 w-full" /></div>
      </div>
    );
  }

  const active = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <MeContext.Provider value={me}>
      <a href="#main" className="sr-only z-50 rounded-lg bg-white px-4 py-2 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
      <div className="min-h-screen lg:flex">
        {/* Desktop sidebar */}
        {/* The aside stretches to the full page height; its contents stay pinned while scrolling */}
        <aside className="hidden w-64 shrink-0 border-r border-line bg-white lg:block">
          <div className="sticky top-0 flex h-screen flex-col">
          <div className="px-5 py-5"><Logo subtitle={me.workshop.name} /></div>
          <nav aria-label="Main" className="flex flex-1 flex-col gap-1 px-3"><NavLinks active={active} /></nav>
          <div className="border-t border-line p-4">
            <div className="flex items-center gap-3">
              <Avatar name={me.user.full_name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{me.user.full_name}</p>
                <p className="truncate text-xs capitalize text-ink-muted">{me.user.role}</p>
              </div>
              <button onClick={signOut} aria-label="Sign out" title="Sign out" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-ink">
                <LogOut aria-hidden className="h-[18px] w-[18px]" />
              </button>
            </div>
          </div>
          </div>
        </aside>

        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <Logo subtitle={me.workshop.name} />
            <button onClick={signOut} aria-label="Sign out" className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100">
              <LogOut aria-hidden className="h-5 w-5" />
            </button>
          </div>
          <nav aria-label="Main" className="grid grid-cols-4 gap-1 px-3 pb-3"><NavLinks active={active} compact /></nav>
        </header>

        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </MeContext.Provider>
  );
}
