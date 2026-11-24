'use client';

import { use } from 'react';
import { useMe } from '@/components/Shell';
import { Card, ErrorBox, Loading, PageHeader, TextLink } from '@/components/ui';
import { api, type CallDetail } from '@/lib/api';
import { formatDateTime, formatDuration, formatPhone, titleCase } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { CallOutcome } from '@/components/CallOutcome';

// "Caller: ..." / "Agent: ..." lines from the voice agent's transcript
function Transcript({ text }: { text: string }) {
  const lines = text.split('\n').filter((l) => l.trim());
  return (
    <ol className="space-y-3">
      {lines.map((line, i) => {
        const match = /^(Caller|Agent|AI|User|Assistant):\s*(.*)$/i.exec(line);
        const speaker = match ? match[1] : null;
        const isCaller = speaker ? /caller|user/i.test(speaker) : false;
        return (
          <li key={i} className={`flex ${isCaller ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${isCaller ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
              {speaker && <p className={`mb-0.5 text-xs font-medium ${isCaller ? 'text-brand-100' : 'text-gray-500'}`}>{isCaller ? 'Caller' : 'AI receptionist'}</p>}
              {match ? match[2] : line}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { workshop } = useMe();
  const { data: call, error, loading, reload } = useLoad(() => api<CallDetail>(`/calls/${id}`), [id]);

  if (loading && !call) return <Loading />;
  if (error) {
    return (
      <>
        <ErrorBox error={error === 'Call not found' ? 'This call does not exist or belongs to another shop.' : error} onRetry={error === 'Call not found' ? undefined : reload} />
        <p className="mt-4"><TextLink href="/calls">← Back to calls</TextLink></p>
      </>
    );
  }
  if (!call) return null;

  const summary = typeof call.structured_data?.summary === 'string' ? call.structured_data.summary : null;
  const details: [string, React.ReactNode][] = [
    ['Caller', <>{call.customer_name || 'Unknown'} · <a className="text-brand-600" href={`tel:${call.customer_phone || call.from_number}`}>{formatPhone(call.customer_phone || call.from_number)}</a></>],
    ['Called from', formatPhone(call.from_number)],
    ['Vehicle', [call.vehicle_make, call.vehicle_model].filter(Boolean).join(' ') || '—'],
    ['Length', formatDuration(call.duration_seconds)],
    ['Ended', call.ended_reason ? titleCase(call.ended_reason) : '—'],
    ['Sentiment', call.sentiment ? titleCase(call.sentiment) : '—']
  ];

  return (
    <>
      <p className="mb-4"><TextLink href="/calls">← Calls</TextLink></p>
      <PageHeader title={`Call on ${formatDateTime(call.started_at, workshop.timezone)}`} actions={<CallOutcome call={call} />} />

      {call.callback_requested && !call.booking_created && (
        <div className="mb-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
          <strong>Call this customer back.</strong> They wanted an appointment but the AI couldn&apos;t book one.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <Card className="p-5">
            <dl className="space-y-3 text-sm">
              {details.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-gray-500">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
          {(summary || call.issue_summary) && (
            <Card className="p-5 text-sm">
              <h2 className="mb-2 font-semibold">Summary</h2>
              <p className="text-gray-700">{summary || call.issue_summary}</p>
            </Card>
          )}
          {call.recording_url && (
            <Card className="p-5 text-sm">
              <h2 className="mb-2 font-semibold">Recording</h2>
              <audio controls preload="none" src={call.recording_url} className="w-full" />
            </Card>
          )}
        </div>

        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 font-semibold">Transcript</h2>
          {call.transcript ? <Transcript text={call.transcript} /> : <p className="text-sm text-gray-500">No transcript for this call.</p>}
        </Card>
      </div>
    </>
  );
}
