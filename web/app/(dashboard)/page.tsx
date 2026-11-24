'use client';

import { useMe } from '@/components/Shell';
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, TextLink } from '@/components/ui';
import { api, type Booking, type CallSummary } from '@/lib/api';
import { formatDateTime, formatPhone, formatTime, shopDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';

export default function OverviewPage() {
  const { workshop } = useMe();
  const tz = workshop.timezone;

  const { data, error, loading, reload } = useLoad(async () => {
    const [upcoming, calls] = await Promise.all([
      api<{ bookings: Booking[] }>(`/bookings?status=confirmed&sort=asc&date_from=${encodeURIComponent(new Date().toISOString())}&limit=100`),
      api<{ calls: CallSummary[]; total: number }>('/calls?limit=100')
    ]);
    return { next: upcoming.bookings, calls };
  });

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const today = shopDate(new Date(), tz);
  const todays = data.next.filter((b) => shopDate(b.scheduled_at, tz) === today);
  const callbacks = data.calls.calls.filter((c) => c.callback_requested && !c.booking_created);
  const weekAgo = Date.now() - 7 * 86400000;
  const callsThisWeek = data.calls.calls.filter((c) => new Date(c.started_at).getTime() > weekAgo);
  const bookedThisWeek = callsThisWeek.filter((c) => c.booking_created).length;

  const stats = [
    { label: 'Appointments left today', value: todays.length },
    { label: 'Need a call back', value: callbacks.length, alert: callbacks.length > 0 },
    { label: 'Calls this week', value: callsThisWeek.length },
    { label: 'Booked by the AI (7 days)', value: callsThisWeek.length ? `${Math.round((bookedThisWeek / callsThisWeek.length) * 100)}%` : '—' }
  ];

  return (
    <>
      <PageHeader title="Overview" subtitle={`All times in ${tz.replace('_', ' ')}`} />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-5">
            <p className="text-sm text-gray-500">{s.label}</p>
            <p className={`mt-1 text-3xl font-semibold ${s.alert ? 'text-amber-600' : ''}`}>{s.value}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <h2 className="font-semibold">Callers waiting for a call back</h2>
            <TextLink href="/calls?filter=callback">All</TextLink>
          </div>
          {callbacks.length === 0 ? (
            <Empty title="Nobody is waiting" hint="Callers the AI couldn't book show up here." />
          ) : (
            <ul className="divide-y divide-gray-100">
              {callbacks.slice(0, 6).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.customer_name || 'Unknown caller'} · <a href={`tel:${c.customer_phone || c.from_number}`} className="text-brand-600">{formatPhone(c.customer_phone || c.from_number)}</a></p>
                    <p className="truncate text-sm text-gray-500">{c.issue_summary || 'No details captured'}</p>
                  </div>
                  <TextLink href={`/calls/${c.id}`}>View</TextLink>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <h2 className="font-semibold">Next appointments</h2>
            <TextLink href="/bookings">All</TextLink>
          </div>
          {data.next.length === 0 ? (
            <Empty title="No upcoming appointments" />
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.next.slice(0, 6).map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{b.customer_name} · {[b.vehicle_make, b.vehicle_model].filter(Boolean).join(' ') || 'Vehicle not given'}</p>
                    <p className="truncate text-sm text-gray-500">{b.issue_summary}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium">{shopDate(b.scheduled_at, tz) === today ? `Today ${formatTime(b.scheduled_at, tz)}` : formatDateTime(b.scheduled_at, tz)}</p>
                    {b.urgency === 'urgent' && <Badge tone="red">Urgent</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
