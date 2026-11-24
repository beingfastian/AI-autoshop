'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Ban, CalendarDays, CalendarX, Car, CircleCheck, PhoneIncoming, UserX } from 'lucide-react';
import { ConfirmDialog, type ConfirmOptions } from '@/components/ConfirmDialog';
import { useMe } from '@/components/Shell';
import { Avatar, Badge, BOOKING_TONE, Button, Card, Empty, ErrorBox, LoadingRows, PageHeader, Pagination, TD, TH } from '@/components/ui';
import { api, ApiError, type Booking } from '@/lib/api';
import { formatPhone, formatTime, titleCase } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';

const PAGE = 25;
const STATUSES = ['confirmed', 'completed', 'cancelled', 'no_show'] as const;
type Action = 'completed' | 'no_show' | 'cancel';

function DateCell({ iso, timeZone }: { iso: string; timeZone: string }) {
  const d = new Date(iso);
  return (
    <div className="flex items-center gap-3">
      <div className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-slate-50 py-1 ring-1 ring-line">
        <span className="text-[10px] font-bold uppercase text-brand-600">{d.toLocaleDateString('en-US', { timeZone, month: 'short' })}</span>
        <span className="text-lg font-bold leading-tight text-ink">{d.toLocaleDateString('en-US', { timeZone, day: 'numeric' })}</span>
      </div>
      <div className="whitespace-nowrap">
        <p className="font-semibold text-ink">{formatTime(iso, timeZone)}</p>
        <p className="text-xs text-ink-muted">{d.toLocaleDateString('en-US', { timeZone, weekday: 'long' })}</p>
      </div>
    </div>
  );
}

function BookingsList() {
  const { workshop } = useMe();
  const tz = workshop.timezone;
  const router = useRouter();
  const params = useSearchParams();
  const view = params.get('view') === 'past' ? 'past' : 'upcoming';
  const status = params.get('status') || '';
  const page = Math.max(Number(params.get('page')) || 1, 1);
  const [pending, setPending] = useState<{ booking: Booking; action: Action } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, error, loading, reload } = useLoad(() => {
    const now = encodeURIComponent(new Date().toISOString());
    const range = view === 'upcoming' ? `date_from=${now}&sort=asc` : `date_to=${now}`;
    return api<{ bookings: Booking[]; total: number }>(`/bookings?${range}${status ? `&status=${status}` : ''}&limit=${PAGE}&offset=${(page - 1) * PAGE}`);
  }, [view, status, page]);

  const go = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    router.push(`/bookings${next.size ? `?${next}` : ''}`);
  };

  const dialog: ConfirmOptions | null = pending && {
    cancel: {
      title: 'Cancel this appointment?',
      message: <>{pending.booking.customer_name}&apos;s appointment will be cancelled and the time freed for other callers.</>,
      confirmLabel: 'Cancel appointment',
      danger: true,
      inputLabel: 'Reason (optional)'
    },
    completed: { title: 'Mark as completed?', message: <>{pending.booking.customer_name}&apos;s visit is done.</>, confirmLabel: 'Mark completed' },
    no_show: { title: 'Mark as a no-show?', message: <>{pending.booking.customer_name} didn&apos;t come to the appointment.</>, confirmLabel: 'Mark no-show', danger: true }
  }[pending.action];

  async function runAction(reason: string) {
    if (!pending) return;
    setActionError(null);
    try {
      if (pending.action === 'cancel') await api(`/bookings/${pending.booking.id}`, { method: 'DELETE', json: { cancellation_reason: reason || null } });
      else await api(`/bookings/${pending.booking.id}`, { method: 'PUT', json: { status: pending.action } });
      setPending(null);
      reload();
    } catch (e) {
      setPending(null);
      setActionError(e instanceof ApiError ? e.message : 'Could not update the appointment');
    }
  }

  const pages = data ? Math.max(Math.ceil(data.total / PAGE), 1) : 1;
  const tab = (value: 'upcoming' | 'past', label: string) => (
    <button
      role="tab"
      aria-selected={view === value}
      onClick={() => go({ view: value === 'upcoming' ? null : value, page: null })}
      className={`h-9 rounded-lg px-4 text-sm font-semibold transition-colors ${view === value ? 'bg-white text-ink shadow-sm ring-1 ring-line' : 'text-ink-muted hover:text-ink'}`}
    >
      {label}
    </button>
  );

  return (
    <>
      <PageHeader
        title="Bookings"
        description="Appointments booked by your AI receptionist or added by your team."
        actions={
          <>
            <div role="tablist" aria-label="Which appointments" className="flex gap-1 rounded-xl bg-slate-100 p-1">{tab('upcoming', 'Upcoming')}{tab('past', 'Past')}</div>
            <label className="sr-only" htmlFor="status-filter">Status</label>
            <select
              id="status-filter"
              value={status}
              onChange={(e) => go({ status: e.target.value, page: null })}
              className="h-11 rounded-xl border border-line bg-white px-3 text-sm font-medium text-ink shadow-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100"
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </select>
          </>
        }
      />
      {actionError && <div className="mb-6"><ErrorBox error={actionError} /></div>}
      {error && <div className="mb-6"><ErrorBox error={error} onRetry={reload} /></div>}

      <Card className="overflow-hidden">
        {loading && !data ? (
          <LoadingRows label="Loading appointments" />
        ) : !data || data.bookings.length === 0 ? (
          <Empty
            icon={view === 'upcoming' ? CalendarDays : CalendarX}
            title={view === 'upcoming' ? 'No upcoming appointments' : 'No past appointments'}
            hint={view === 'upcoming' ? 'New bookings from the AI receptionist appear here instantly.' : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="border-b border-line bg-slate-50/80">
                <tr>
                  <th scope="col" className={TH}>Appointment</th>
                  <th scope="col" className={TH}>Customer</th>
                  <th scope="col" className={TH}>Vehicle and issue</th>
                  <th scope="col" className={TH}>Status</th>
                  <th scope="col" className={`${TH} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.bookings.map((b) => {
                  const open = b.status === 'confirmed' || b.status === 'pending';
                  const started = new Date(b.scheduled_at) <= new Date();
                  return (
                    <tr key={b.id} className="transition-colors hover:bg-slate-50/60">
                      <td className={TD}><DateCell iso={b.scheduled_at} timeZone={tz} /></td>
                      <td className={TD}>
                        <div className="flex items-center gap-3">
                          <Avatar name={b.customer_name} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-ink">{b.customer_name}</p>
                            <a href={`tel:${b.customer_phone}`} className="text-ink-muted hover:text-brand-700">{formatPhone(b.customer_phone)}</a>
                          </div>
                        </div>
                      </td>
                      <td className={`${TD} max-w-[18rem]`}>
                        <p className="flex items-center gap-1.5 truncate font-medium text-ink">
                          <Car aria-hidden className="h-4 w-4 shrink-0 text-slate-400" />
                          <span className="truncate">{[b.vehicle_year, b.vehicle_make, b.vehicle_model].filter(Boolean).join(' ') || 'Not given'}</span>
                        </p>
                        <p className="mt-0.5 truncate text-ink-muted">{b.issue_summary}</p>
                        {b.call_id && (
                          <Link href={`/calls/${b.call_id}`} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700">
                            <PhoneIncoming aria-hidden className="h-3 w-3" /> Booked by phone
                          </Link>
                        )}
                      </td>
                      <td className={TD}>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge tone={BOOKING_TONE[b.status]}>{titleCase(b.status)}</Badge>
                          {b.urgency === 'urgent' && <Badge tone="red">Urgent</Badge>}
                        </div>
                        {b.cancellation_reason && <p className="mt-1.5 max-w-[12rem] truncate text-xs text-ink-muted" title={b.cancellation_reason}>“{b.cancellation_reason}”</p>}
                      </td>
                      <td className={`${TD} text-right`}>
                        {open ? (
                          <div className="flex justify-end gap-2">
                            {started && <Button size="sm" variant="secondary" icon={CircleCheck} onClick={() => setPending({ booking: b, action: 'completed' })}>Done</Button>}
                            {started && <Button size="sm" variant="ghost" icon={UserX} onClick={() => setPending({ booking: b, action: 'no_show' })}>No-show</Button>}
                            <Button size="sm" variant="ghost" icon={Ban} onClick={() => setPending({ booking: b, action: 'cancel' })} aria-label={`Cancel ${b.customer_name}'s appointment`}>Cancel</Button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} onChange={(p) => go({ page: p === 1 ? null : String(p) })} />
      </Card>

      <ConfirmDialog options={dialog} onConfirm={runAction} onClose={() => setPending(null)} />
    </>
  );
}

export default function BookingsPage() {
  return (
    <Suspense fallback={<Card><LoadingRows label="Loading appointments" /></Card>}>
      <BookingsList />
    </Suspense>
  );
}
