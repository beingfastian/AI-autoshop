'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMe } from '@/components/Shell';
import { CallOutcome } from '@/components/CallOutcome';
import { Card, Empty, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { api, type CallSummary } from '@/lib/api';
import { formatDateTime, formatDuration, formatPhone } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';

const PAGE = 25;

function CallsList() {
  const { workshop } = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const page = Math.max(Number(params.get('page')) || 1, 1);
  const onlyCallbacks = params.get('filter') === 'callback';

  const { data, error, loading, reload } = useLoad(
    () => api<{ calls: CallSummary[]; total: number }>(`/calls?limit=${PAGE}&offset=${(page - 1) * PAGE}`),
    [page]
  );

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    router.push(`/calls?${next}`);
  };

  const calls = (data?.calls || []).filter((c) => !onlyCallbacks || (c.callback_requested && !c.booking_created));
  const pages = data ? Math.max(Math.ceil(data.total / PAGE), 1) : 1;

  return (
    <>
      <PageHeader
        title="Calls"
        subtitle="Every call the AI answered, newest first"
        actions={
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={onlyCallbacks} onChange={(e) => setParam('filter', e.target.checked ? 'callback' : null)} className="h-4 w-4 rounded border-gray-300" />
            Only callers needing a call back
          </label>
        }
      />
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : (
        <Card className="overflow-hidden">
          {calls.length === 0 ? (
            <Empty title={onlyCallbacks ? 'Nobody is waiting for a call back' : 'No calls yet'} hint={onlyCallbacks ? undefined : 'Calls appear here as soon as the AI answers one.'} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">When</th>
                    <th className="px-5 py-3 font-medium">Caller</th>
                    <th className="px-5 py-3 font-medium">Vehicle and issue</th>
                    <th className="px-5 py-3 font-medium">Outcome</th>
                    <th className="px-5 py-3 font-medium">Length</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {calls.map((c) => (
                    <tr key={c.id} className="cursor-pointer hover:bg-gray-50" onClick={() => router.push(`/calls/${c.id}`)}>
                      <td className="whitespace-nowrap px-5 py-3">
                        <Link href={`/calls/${c.id}`} className="font-medium text-gray-900 hover:text-brand-700" onClick={(e) => e.stopPropagation()}>
                          {formatDateTime(c.started_at, workshop.timezone)}
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        <p className="font-medium">{c.customer_name || 'Unknown'}</p>
                        <p className="text-gray-500">{formatPhone(c.customer_phone || c.from_number)}</p>
                      </td>
                      <td className="max-w-xs px-5 py-3">
                        <p className="truncate">{[c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ') || '—'}</p>
                        <p className="truncate text-gray-500">{c.issue_summary || ''}</p>
                      </td>
                      <td className="px-5 py-3"><CallOutcome call={c} /></td>
                      <td className="whitespace-nowrap px-5 py-3 text-gray-500">{formatDuration(c.duration_seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3 text-sm">
              <button disabled={page <= 1} onClick={() => setParam('page', String(page - 1))} className="font-medium text-brand-600 disabled:text-gray-300">← Newer</button>
              <span className="text-gray-500">Page {page} of {pages}</span>
              <button disabled={page >= pages} onClick={() => setParam('page', String(page + 1))} className="font-medium text-brand-600 disabled:text-gray-300">Older →</button>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

export default function CallsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <CallsList />
    </Suspense>
  );
}
