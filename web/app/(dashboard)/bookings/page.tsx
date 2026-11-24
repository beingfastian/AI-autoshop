'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMe } from '@/components/Shell';
import { Badge, BOOKING_TONE, Card, Empty, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { api, ApiError, type Booking } from '@/lib/api';
import { formatDateTime, formatPhone, titleCase } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';

const PAGE = 25;
const STATUSES = ['confirmed', 'completed', 'cancelled', 'no_show'] as const;

function BookingsList() {
  const { workshop } = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const view = params.get('view') === 'past' ? 'past' : 'upcoming';
  const status = params.get('status') || '';
  const page = Math.max(Number(params.get('page')) || 1, 1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, error, loading, reload } = useLoad(() => {
    const now = encodeURIComponent(new Date().toISOString());
    const range = view === 'upcoming' ? `date_from=${now}&sort=asc` : `date_to=${now}`;
    const filter = status ? `&status=${status}` : '';
    return api<{ bookings: Booking[]; total: number }>(`/bookings?${range}${filter}&limit=${PAGE}&offset=${(page - 1) * PAGE}`);
  }, [view, status, page]);

  const setParams = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    router.push(`/bookings?${next}`);
  };

  async function act(booking: Booking, action: 'completed' | 'no_show' | 'cancel') {
    const who = `${booking.customer_name}, ${formatDateTime(booking.scheduled_at, workshop.timezone)}`;
    let reason: string | null = null;
    if (action === 'cancel') {
      reason = window.prompt(`Cancel the appointment for ${who}?\n\nReason (optional):`, '');
      if (reason === null) return; // dismissed
    } else if (!window.confirm(`Mark ${who} as ${action === 'completed' ? 'completed' : 'a no-show'}?`)) {
      return;
    }
    setBusyId(booking.id);
    setActionError(null);
    try {
      if (action === 'cancel') await api(`/bookings/${booking.id}`, { method: 'DELETE', json: { cancellation_reason: reason } });
      else await api(`/bookings/${booking.id}`, { method: 'PUT', json: { status: action } });
      reload();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Could not update the booking');
    } finally {
      setBusyId(null);
    }
  }

  const pages = data ? Math.max(Math.ceil(data.total / PAGE), 1) : 1;
  const tab = (value: 'upcoming' | 'past', label: string) => (
    <button
      onClick={() => setParams({ view: value === 'upcoming' ? null : value, page: null })}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${view === value ? 'bg-white shadow-sm ring-1 ring-gray-200' : 'text-gray-600 hover:text-gray-900'}`}
    >
      {label}
    </button>
  );

  return (
    <>
      <PageHeader
        title="Bookings"
        subtitle="Appointments booked by the AI or added by staff"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1 rounded-xl bg-gray-100 p-1">{tab('upcoming', 'Upcoming')}{tab('past', 'Past')}</div>
            <select
              aria-label="Status"
              value={status}
              onChange={(e) => setParams({ status: e.target.value, page: null })}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm"
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </select>
          </div>
        }
      />
      {actionError && <div className="mb-4"><ErrorBox error={actionError} /></div>}
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : (
        <Card className="overflow-hidden">
          {!data || data.bookings.length === 0 ? (
            <Empty title={view === 'upcoming' ? 'No upcoming appointments' : 'No past appointments'} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">When</th>
                    <th className="px-5 py-3 font-medium">Customer</th>
                    <th className="px-5 py-3 font-medium">Vehicle and issue</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.bookings.map((b) => {
                    const open = b.status === 'confirmed' || b.status === 'pending';
                    const started = new Date(b.scheduled_at) <= new Date();
                    return (
                      <tr key={b.id} className="align-top">
                        <td className="whitespace-nowrap px-5 py-3">
                          <p className="font-medium">{formatDateTime(b.scheduled_at, workshop.timezone)}</p>
                          {b.call_id && <Link href={`/calls/${b.call_id}`} className="text-xs text-brand-600">Booked by phone</Link>}
                        </td>
                        <td className="px-5 py-3">
                          <p className="font-medium">{b.customer_name}</p>
                          <p className="text-gray-500"><a href={`tel:${b.customer_phone}`}>{formatPhone(b.customer_phone)}</a></p>
                        </td>
                        <td className="max-w-xs px-5 py-3">
                          <p className="truncate">{[b.vehicle_year, b.vehicle_make, b.vehicle_model].filter(Boolean).join(' ') || '—'}</p>
                          <p className="truncate text-gray-500">{b.issue_summary}</p>
                        </td>
                        <td className="space-x-1 whitespace-nowrap px-5 py-3">
                          <Badge tone={BOOKING_TONE[b.status]}>{titleCase(b.status)}</Badge>
                          {b.urgency === 'urgent' && <Badge tone="red">Urgent</Badge>}
                          {b.cancellation_reason && <p className="mt-1 max-w-[14rem] truncate text-xs text-gray-500">{b.cancellation_reason}</p>}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right">
                          {open && (
                            <div className="flex justify-end gap-3 text-sm font-medium">
                              {started && <button disabled={busyId === b.id} onClick={() => act(b, 'completed')} className="text-green-700 hover:underline disabled:opacity-40">Completed</button>}
                              {started && <button disabled={busyId === b.id} onClick={() => act(b, 'no_show')} className="text-gray-700 hover:underline disabled:opacity-40">No-show</button>}
                              <button disabled={busyId === b.id} onClick={() => act(b, 'cancel')} className="text-red-700 hover:underline disabled:opacity-40">Cancel</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3 text-sm">
              <button disabled={page <= 1} onClick={() => setParams({ page: String(page - 1) })} className="font-medium text-brand-600 disabled:text-gray-300">← Previous</button>
              <span className="text-gray-500">Page {page} of {pages}</span>
              <button disabled={page >= pages} onClick={() => setParams({ page: String(page + 1) })} className="font-medium text-brand-600 disabled:text-gray-300">Next →</button>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

export default function BookingsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <BookingsList />
    </Suspense>
  );
}
