'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronRight, PhoneCall, PhoneOutgoing } from 'lucide-react';
import { CallOutcome } from '@/components/CallOutcome';
import { useMe } from '@/components/Shell';
import { Avatar, Card, Empty, ErrorBox, LoadingRows, PageHeader, Pagination, TD, TH } from '@/components/ui';
import { api, type CallSummary } from '@/lib/api';
import { formatDateTime, formatDuration, formatPhone } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';

const PAGE = 25;

function Tabs({ value, onChange }: { value: 'all' | 'callback'; onChange: (v: 'all' | 'callback') => void }) {
  const tab = (key: 'all' | 'callback', label: string) => (
    <button
      role="tab"
      aria-selected={value === key}
      onClick={() => onChange(key)}
      className={`h-9 rounded-lg px-4 text-sm font-semibold transition-colors ${value === key ? 'bg-white text-ink shadow-sm ring-1 ring-line' : 'text-ink-muted hover:text-ink'}`}
    >
      {label}
    </button>
  );
  return <div role="tablist" aria-label="Filter calls" className="flex gap-1 rounded-xl bg-slate-100 p-1">{tab('all', 'All calls')}{tab('callback', 'Need a call back')}</div>;
}

function CallsList() {
  const { workshop } = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const page = Math.max(Number(params.get('page')) || 1, 1);
  const filter = params.get('filter') === 'callback' ? 'callback' : 'all';

  const { data, error, loading, reload } = useLoad(
    () => api<{ calls: CallSummary[]; total: number }>(`/calls?limit=${PAGE}&offset=${(page - 1) * PAGE}`),
    [page]
  );

  const go = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.push(`/dashboard/calls${next.size ? `?${next}` : ''}`);
  };

  const calls = (data?.calls || []).filter((c) => filter === 'all' || (c.callback_requested && !c.booking_created));
  const pages = data ? Math.max(Math.ceil(data.total / PAGE), 1) : 1;

  return (
    <>
      <PageHeader
        title="Calls"
        description="Every call your AI receptionist answered, newest first."
        actions={<Tabs value={filter} onChange={(v) => go({ filter: v === 'all' ? null : v, page: null })} />}
      />
      {error && <div className="mb-6"><ErrorBox error={error} onRetry={reload} /></div>}
      <Card className="overflow-hidden">
        {loading && !data ? (
          <LoadingRows label="Loading calls" />
        ) : calls.length === 0 ? (
          filter === 'callback'
            ? <Empty icon={PhoneOutgoing} title="Nobody is waiting for a call back" hint="Callers the AI couldn't book show up here." />
            : <Empty icon={PhoneCall} title="No calls yet" hint="As soon as your AI receptionist answers a call, it appears here with a full transcript." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-line bg-slate-50/80">
                <tr>
                  <th scope="col" className={TH}>Caller</th>
                  <th scope="col" className={TH}>Vehicle and issue</th>
                  <th scope="col" className={TH}>When</th>
                  <th scope="col" className={TH}>Length</th>
                  <th scope="col" className={TH}>Outcome</th>
                  <th scope="col" className={TH}><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {calls.map((c) => (
                  <tr key={c.id} className="group relative transition-colors hover:bg-slate-50">
                    <td className={TD}>
                      <div className="flex items-center gap-3">
                        <Avatar name={c.customer_name} size="sm" />
                        <div className="min-w-0">
                          <Link href={`/dashboard/calls/${c.id}`} className="block truncate font-semibold text-ink after:absolute after:inset-0 group-hover:text-brand-700">
                            {c.customer_name || 'Unknown caller'}
                          </Link>
                          <p className="text-ink-muted">{formatPhone(c.customer_phone || c.from_number)}</p>
                        </div>
                      </div>
                    </td>
                    <td className={`${TD} max-w-[18rem]`}>
                      <p className="truncate font-medium text-ink">{[c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ') || '—'}</p>
                      <p className="truncate text-ink-muted">{c.issue_summary || 'No details captured'}</p>
                    </td>
                    <td className={`${TD} whitespace-nowrap text-ink-muted`}>{formatDateTime(c.started_at, workshop.timezone)}</td>
                    <td className={`${TD} whitespace-nowrap tabular-nums text-ink-muted`}>{formatDuration(c.duration_seconds)}</td>
                    <td className={TD}><CallOutcome call={c} /></td>
                    <td className={`${TD} w-10 text-right`}>
                      <ChevronRight aria-hidden className="ml-auto h-4 w-4 text-slate-300 transition-colors group-hover:text-slate-500" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} onChange={(p) => go({ page: p === 1 ? null : String(p) })} labels={['Newer', 'Older']} />
      </Card>
    </>
  );
}

export default function CallsPage() {
  return (
    <Suspense fallback={<Card><LoadingRows label="Loading calls" /></Card>}>
      <CallsList />
    </Suspense>
  );
}
