'use client';

import Link from 'next/link';
import { ArrowRight, CalendarCheck, CalendarDays, Car, PhoneCall, PhoneIncoming, PhoneOutgoing, TrendingUp, type LucideIcon } from 'lucide-react';
import { CallsChart } from '@/components/CallsChart';
import { useMe } from '@/components/Shell';
import { Avatar, Badge, Card, CardHeader, Empty, ErrorBox, PageHeader, Skeleton, TextLink } from '@/components/ui';
import { api, type Booking, type CallSummary } from '@/lib/api';
import { formatPhone, formatTime, shopDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';

function greeting(timeZone: string) {
  const hour = Number(new Date().toLocaleString('en-US', { timeZone, hour: 'numeric', hour12: false }));
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function Stat({ icon: Icon, label, value, hint, tone = 'blue' }: { icon: LucideIcon; label: string; value: React.ReactNode; hint?: string; tone?: 'blue' | 'orange' | 'green' | 'slate' }) {
  const tones = {
    blue: 'bg-brand-50 text-brand-600',
    orange: 'bg-attention-50 text-attention-600',
    green: 'bg-emerald-50 text-emerald-600',
    slate: 'bg-slate-100 text-slate-600'
  };
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink-muted">{label}</p>
        <span aria-hidden className={`flex h-9 w-9 items-center justify-center rounded-xl ${tones[tone]}`}><Icon className="h-[18px] w-[18px]" /></span>
      </div>
      <p className="mt-3 text-3xl font-bold tracking-tight text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </Card>
  );
}

function dayLabel(iso: string, tz: string, today: string, tomorrow: string) {
  const d = shopDate(iso, tz);
  if (d === today) return 'Today';
  if (d === tomorrow) return 'Tomorrow';
  return new Date(iso).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
}

export default function OverviewPage() {
  const { user, workshop } = useMe();
  const tz = workshop.timezone;

  const { data, error, loading, reload } = useLoad(async () => {
    const [upcoming, calls] = await Promise.all([
      api<{ bookings: Booking[] }>(`/bookings?status=confirmed&sort=asc&date_from=${encodeURIComponent(new Date().toISOString())}&limit=100`),
      api<{ calls: CallSummary[]; total: number }>('/calls?limit=200')
    ]);
    return { next: upcoming.bookings, calls: calls.calls };
  });

  const firstName = user.full_name.split(' ')[0];
  const header = (
    <PageHeader
      title={`${greeting(tz)}, ${firstName}`}
      description={<>Here&apos;s what&apos;s happening at {workshop.name} · {new Date().toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' })}</>}
    />
  );

  if (error) return <>{header}<ErrorBox error={error} onRetry={reload} /></>;
  if (loading && !data) {
    return (
      <>
        {header}
        <div role="status" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <span className="sr-only">Loading…</span>
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[124px] rounded-2xl" />)}
        </div>
        <Skeleton className="mt-6 h-72 rounded-2xl" />
      </>
    );
  }
  if (!data) return null;

  const today = shopDate(new Date(), tz);
  const tomorrow = shopDate(new Date(Date.now() + 86400000), tz);
  const todays = data.next.filter((b) => shopDate(b.scheduled_at, tz) === today);
  const callbacks = data.calls.filter((c) => c.callback_requested && !c.booking_created);
  const weekAgo = Date.now() - 7 * 86400000;
  const week = data.calls.filter((c) => new Date(c.started_at).getTime() > weekAgo);
  const bookedWeek = week.filter((c) => c.booking_created).length;

  return (
    <>
      {header}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={CalendarDays} label="Left today" value={todays.length} hint={todays[0] ? `Next at ${formatTime(todays[0].scheduled_at, tz)}` : 'No more appointments today'} />
        <Stat icon={PhoneOutgoing} label="Need a call back" value={callbacks.length} tone={callbacks.length ? 'orange' : 'slate'} hint={callbacks.length ? 'Callers the AI could not book' : 'Nobody is waiting'} />
        <Stat icon={PhoneIncoming} label="Calls this week" value={week.length} tone="slate" hint="Answered by the AI" />
        <Stat icon={TrendingUp} label="Booked by the AI" value={week.length ? `${Math.round((bookedWeek / week.length) * 100)}%` : '—'} tone="green" hint={`${bookedWeek} of ${week.length} calls this week`} />
      </div>

      <Card className="mt-6">
        <CardHeader icon={PhoneCall} title="Call activity" description="Every call the AI answered, and how many became bookings" />
        <div className="px-5 py-5 sm:px-6"><CallsChart calls={data.calls} timeZone={tz} /></div>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            icon={PhoneOutgoing}
            title="Waiting for a call back"
            description="They wanted an appointment but weren't booked"
            action={callbacks.length > 0 ? <TextLink href="/calls?filter=callback">View all</TextLink> : undefined}
          />
          {callbacks.length === 0 ? (
            <Empty icon={PhoneOutgoing} title="Nobody is waiting" hint="When the AI can't book a caller, they show up here so you can call them back." />
          ) : (
            <ul className="divide-y divide-line">
              {callbacks.slice(0, 5).map((c) => {
                const phone = c.customer_phone || c.from_number;
                return (
                  <li key={c.id} className="flex items-center gap-4 px-5 py-4 sm:px-6">
                    <Avatar name={c.customer_name} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/calls/${c.id}`} className="block truncate font-semibold text-ink hover:text-brand-700">{c.customer_name || 'Unknown caller'}</Link>
                      <p className="truncate text-sm text-ink-muted">{c.issue_summary || 'No details captured'}</p>
                    </div>
                    <a
                      href={`tel:${phone}`}
                      aria-label={`Call ${c.customer_name || 'the caller'} at ${formatPhone(phone)}`}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-attention-50 text-sm font-semibold text-attention-700 ring-1 ring-attention-600/20 transition-colors hover:bg-attention-100 sm:h-9 sm:w-auto sm:px-3"
                    >
                      <PhoneOutgoing aria-hidden className="h-4 w-4" /> <span className="hidden sm:inline">{formatPhone(phone)}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader icon={CalendarCheck} title="Next appointments" action={data.next.length > 0 ? <TextLink href="/bookings">View all</TextLink> : undefined} />
          {data.next.length === 0 ? (
            <Empty icon={CalendarDays} title="No upcoming appointments" hint="Bookings made by the AI or your team appear here." />
          ) : (
            <ul className="divide-y divide-line">
              {data.next.slice(0, 5).map((b) => (
                <li key={b.id} className="flex items-center gap-4 px-5 py-4 sm:px-6">
                  <div className="flex w-[84px] shrink-0 flex-col items-center whitespace-nowrap rounded-xl bg-slate-50 py-1.5 ring-1 ring-line">
                    <span className="text-[11px] font-semibold uppercase text-brand-600">{dayLabel(b.scheduled_at, tz, today, tomorrow).split(',')[0]}</span>
                    <span className="text-sm font-bold text-ink">{formatTime(b.scheduled_at, tz)}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{b.customer_name}</p>
                    <p className="flex min-w-0 items-center gap-1.5 text-sm text-ink-muted">
                      <Car aria-hidden className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{[b.vehicle_make, b.vehicle_model].filter(Boolean).join(' ') || 'Vehicle not given'} · {b.issue_summary}</span>
                    </p>
                  </div>
                  {b.urgency === 'urgent' && <Badge tone="red">Urgent</Badge>}
                </li>
              ))}
            </ul>
          )}
          {data.next.length > 5 && (
            <Link href="/bookings" className="flex items-center justify-center gap-1.5 border-t border-line py-3 text-sm font-semibold text-brand-600 hover:bg-slate-50">
              {data.next.length - 5} more <ArrowRight aria-hidden className="h-4 w-4" />
            </Link>
          )}
        </Card>
      </div>
    </>
  );
}
