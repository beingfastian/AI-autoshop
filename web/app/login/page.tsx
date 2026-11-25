'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, CalendarCheck, CircleAlert, Clock, Mail, PhoneIncoming } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui';
import { api, ApiError, type User } from '@/lib/api';
import { BRAND_TAGLINE, DEMO_LOGIN } from '@/lib/brand';
import Link from 'next/link';

const FEATURES = [
  { icon: PhoneIncoming, title: 'Answers every call', text: 'Day, night and weekends. No more missed customers or voicemail.' },
  { icon: CalendarCheck, title: 'Books real appointments', text: 'Checks your hours, holidays and free bays before offering a time.' },
  { icon: Mail, title: 'Keeps everyone in the loop', text: 'Confirmations and reminders for customers, alerts for your team.' }
];

const field =
  'mt-2 block h-12 w-full rounded-xl border border-line bg-white px-4 text-[15px] text-ink shadow-sm transition-colors placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  // /login?demo fills in the public demo login (only when one is configured)
  const demo = params.has('demo') && DEMO_LOGIN ? DEMO_LOGIN : null;
  const [email, setEmail] = useState(demo?.email ?? '');
  const [password, setPassword] = useState(demo?.password ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Only return to paths on this site (never an outside URL passed in ?next=)
  const next = params.get('next');
  const destination = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api<{ user: User }>('/auth/login', { method: 'POST', json: { email, password } });
      router.replace(destination);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the server. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {demo && (
        <p className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
          The demo login is filled in. Press <strong>Sign in</strong> to look around a sample shop.
        </p>
      )}
      <div>
        <label htmlFor="email" className="text-sm font-semibold text-ink">Work email</label>
        <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourshop.com" className={field} />
      </div>
      <div>
        <label htmlFor="password" className="text-sm font-semibold text-ink">Password</label>
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
      </div>
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
      <Button type="submit" loading={busy} disabled={!email || !password} className="h-12 w-full text-[15px]">
        {busy ? 'Signing in…' : <>Sign in <ArrowRight aria-hidden className="h-4 w-4" /></>}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <section aria-label="About the product" className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-700 to-brand-900 p-12 text-white lg:flex lg:flex-col">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:44px_44px]" />
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-500/40 blur-3xl" />
        <div className="relative"><Link href="/" aria-label="Back to the home page" className="inline-block rounded-xl"><Logo tone="light" subtitle={BRAND_TAGLINE} /></Link></div>

        <div className="relative mt-auto max-w-lg">
          <h1 className="text-4xl font-bold leading-tight tracking-tight">Never miss a customer call again.</h1>
          <p className="mt-4 text-lg text-brand-100">Your AI receptionist answers the phone, understands the car problem and books the appointment while your team keeps working.</p>

          <ul className="mt-10 space-y-5">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20"><Icon className="h-5 w-5" /></span>
                <div>
                  <p className="font-semibold">{title}</p>
                  <p className="text-sm text-brand-100">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Example of what the AI produces (illustrative, not live data) */}
        <figure aria-label="Example booking made by the AI receptionist" className="relative mt-12 max-w-sm rounded-2xl border border-white/20 bg-white/10 p-4 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between text-xs text-brand-100">
            <span className="flex items-center gap-1.5"><Clock aria-hidden className="h-3.5 w-3.5" /> Booked by phone · 1 min ago</span>
            <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 font-semibold text-emerald-100">Confirmed</span>
          </div>
          <p className="mt-3 font-semibold">Brake inspection · 2019 Honda Civic</p>
          <p className="text-sm text-brand-100">Tuesday, 2:00 PM · Maria Lopez</p>
        </figure>
        <div className="relative mt-auto pt-10 text-xs text-brand-100/80">© {new Date().getFullYear()} · Built for independent auto repair shops</div>
      </section>

      {/* Sign-in */}
      <main className="flex items-center justify-center bg-white px-6 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden"><Link href="/" aria-label="Back to the home page" className="inline-block rounded-xl"><Logo subtitle={BRAND_TAGLINE} /></Link></div>
          <h2 className="text-2xl font-bold tracking-tight text-ink">Welcome back</h2>
          <p className="mt-2 text-sm text-ink-muted">Sign in to see your calls, bookings and shop settings.</p>
          <div className="mt-8">
            <Suspense><LoginForm /></Suspense>
          </div>
          <p className="mt-8 text-center text-xs text-ink-muted">Need access? Ask your shop owner to create a login for you.</p>
        </div>
      </main>
    </div>
  );
}
