'use client';

import Link from 'next/link';
import { use } from 'react';
import { ArrowLeft, Bot, Car, Clock, FileText, MessageSquareText, Phone, PhoneOutgoing, Smile, Timer, type LucideIcon } from 'lucide-react';
import { CallOutcome } from '@/components/CallOutcome';
import { useMe } from '@/components/Shell';
import { Avatar, Card, CardHeader, Empty, ErrorBox, PageHeader, Skeleton } from '@/components/ui';
import { api, type CallDetail } from '@/lib/api';
import { formatDateTime, formatDuration, formatPhone, titleCase } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';

type Line = { speaker: 'caller' | 'ai' | null; text: string };

function parseTranscript(text: string): Line[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(Caller|User|Customer|Agent|AI|Assistant|Bot):\s*(.*)$/i.exec(line);
      if (!match) return { speaker: null, text: line };
      return { speaker: /caller|user|customer/i.test(match[1]) ? 'caller' : 'ai', text: match[2] };
    });
}

function Transcript({ text, callerName }: { text: string; callerName: string | null }) {
  const lines = parseTranscript(text);
  return (
    <ol className="space-y-4" aria-label="Call transcript">
      {lines.map((line, i) => {
        const caller = line.speaker === 'caller';
        return (
          <li key={i} className={`flex items-end gap-2.5 ${caller ? 'flex-row-reverse' : ''}`}>
            {caller ? (
              <Avatar name={callerName || 'Caller'} size="sm" />
            ) : (
              <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white"><Bot className="h-4 w-4" /></span>
            )}
            <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${caller ? 'rounded-br-md bg-brand-600 text-white' : 'rounded-bl-md bg-slate-100 text-ink'}`}>
              <p className={`mb-0.5 text-xs font-semibold ${caller ? 'text-brand-100' : 'text-ink-muted'}`}>{caller ? callerName || 'Caller' : 'AI receptionist'}</p>
              {line.text}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Detail({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-3">
      <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
      <div className="min-w-0">
        <dt className="text-xs font-medium text-ink-muted">{label}</dt>
        <dd className="mt-0.5 font-medium text-ink">{children}</dd>
      </div>
    </div>
  );
}

export default function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { workshop } = useMe();
  const { data: call, error, loading, reload } = useLoad(() => api<CallDetail>(`/calls/${id}`), [id]);

  const back = (
    <Link href="/calls" className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted transition-colors hover:text-ink">
      <ArrowLeft aria-hidden className="h-4 w-4" /> All calls
    </Link>
  );

  if (error) {
    const missing = error === 'Call not found';
    return <>{back}<ErrorBox error={missing ? 'This call does not exist or belongs to another shop.' : error} onRetry={missing ? undefined : reload} /></>;
  }
  if (loading && !call) {
    return (
      <>{back}
        <div role="status"><span className="sr-only">Loading call…</span>
          <Skeleton className="h-9 w-72" />
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3"><Skeleton className="h-80 rounded-2xl" /><Skeleton className="h-80 rounded-2xl lg:col-span-2" /></div>
        </div>
      </>
    );
  }
  if (!call) return null;

  const phone = call.customer_phone || call.from_number;
  const summary = typeof call.structured_data?.summary === 'string' ? call.structured_data.summary : null;
  const needsCallback = Boolean(call.callback_requested && !call.booking_created);

  return (
    <>
      {back}
      <PageHeader
        title={call.customer_name || 'Unknown caller'}
        description={<span className="flex items-center gap-1.5"><Clock aria-hidden className="h-4 w-4" /> {formatDateTime(call.started_at, workshop.timezone)}</span>}
        actions={<CallOutcome call={call} />}
      />

      {needsCallback && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-attention-600/25 bg-attention-50 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-attention-600 ring-1 ring-attention-600/20"><PhoneOutgoing className="h-5 w-5" /></span>
            <div>
              <p className="font-semibold text-attention-700">Call this customer back</p>
              <p className="text-sm text-attention-700/90">They wanted an appointment, but the AI couldn&apos;t book one.</p>
            </div>
          </div>
          <a href={`tel:${phone}`} className="inline-flex h-11 items-center gap-2 rounded-xl bg-attention-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-attention-700">
            <Phone aria-hidden className="h-4 w-4" /> Call {formatPhone(phone)}
          </a>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Card>
            <CardHeader icon={FileText} title="Call details" />
            <dl className="divide-y divide-line px-5 sm:px-6">
              <Detail icon={Phone} label="Phone"><a href={`tel:${phone}`} className="text-brand-600 hover:text-brand-700">{formatPhone(phone)}</a></Detail>
              <Detail icon={Car} label="Vehicle">{[call.vehicle_make, call.vehicle_model].filter(Boolean).join(' ') || 'Not given'}</Detail>
              <Detail icon={Timer} label="Length">{formatDuration(call.duration_seconds)}</Detail>
              <Detail icon={Smile} label="Caller mood">{call.sentiment ? titleCase(call.sentiment) : '—'}</Detail>
              <Detail icon={Clock} label="Ended">{call.ended_reason ? titleCase(call.ended_reason.replace(/-/g, ' ')) : '—'}</Detail>
            </dl>
          </Card>

          {(summary || call.issue_summary) && (
            <Card className="p-5 sm:p-6">
              <h2 className="text-sm font-semibold text-ink">Summary</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{summary || call.issue_summary}</p>
            </Card>
          )}

          {call.recording_url && (
            <Card className="p-5 sm:p-6">
              <h2 className="text-sm font-semibold text-ink">Recording</h2>
              <audio controls preload="none" src={call.recording_url} className="mt-3 w-full" />
            </Card>
          )}
        </div>

        <Card className="lg:col-span-2">
          <CardHeader icon={MessageSquareText} title="Conversation" description="What the caller and the AI receptionist said" />
          <div className="p-5 sm:p-6">
            {call.transcript
              ? <Transcript text={call.transcript} callerName={call.customer_name} />
              : <Empty icon={MessageSquareText} title="No transcript for this call" hint="The call may have ended before anything was said." />}
          </div>
        </Card>
      </div>
    </>
  );
}
