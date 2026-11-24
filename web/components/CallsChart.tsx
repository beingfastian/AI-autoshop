'use client';

// Calls per day for the last 14 days, split into booked / not booked.
// Accessible: each bar shows its numbers on hover AND keyboard focus; booked vs not booked differ
// by fill style (solid vs outlined), not colour alone; a summary sentence and a screen-reader
// table carry the same data.
import { useMemo, useState } from 'react';
import type { CallSummary } from '@/lib/api';
import { shopDate } from '@/lib/format';

const DAYS = 14;

export function CallsChart({ calls, timeZone }: { calls: CallSummary[]; timeZone: string }) {
  const [focus, setFocus] = useState<number | null>(null);

  const days = useMemo(() => {
    const out: { date: string; label: string; weekday: string; total: number; booked: number }[] = [];
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      out.push({
        date: shopDate(d, timeZone),
        label: d.toLocaleDateString('en-US', { timeZone, month: 'short', day: 'numeric' }),
        weekday: d.toLocaleDateString('en-US', { timeZone, weekday: 'short' }),
        total: 0,
        booked: 0
      });
    }
    const byDate = new Map(out.map((d) => [d.date, d]));
    for (const c of calls) {
      const day = byDate.get(shopDate(c.started_at, timeZone));
      if (!day) continue;
      day.total++;
      if (c.booking_created) day.booked++;
    }
    return out;
  }, [calls, timeZone]);

  const max = Math.max(4, ...days.map((d) => d.total));
  const total = days.reduce((n, d) => n + d.total, 0);
  const booked = days.reduce((n, d) => n + d.booked, 0);
  const shown = focus !== null ? days[focus] : null;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="text-sm text-ink-muted" aria-live="polite">
          {shown ? (
            <><span className="font-semibold text-ink">{shown.weekday} {shown.label}:</span> {shown.total} call{shown.total === 1 ? '' : 's'}, {shown.booked} booked</>
          ) : (
            <><span className="font-semibold text-ink">{total} calls</span> in the last {DAYS} days · {booked} booked by the AI{total ? ` (${Math.round((booked / total) * 100)}%)` : ''}</>
          )}
        </p>
        <div className="flex items-center gap-4 text-xs font-medium text-ink-muted" aria-hidden>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-brand-600" /> Booked</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border-2 border-brand-300 bg-brand-50" /> Not booked</span>
        </div>
      </div>

      <div className="mt-5 flex h-48 items-end gap-1.5 sm:gap-2.5" aria-hidden={false}>
        {days.map((d, i) => {
          const totalPct = (d.total / max) * 100;
          const bookedPct = d.total ? (d.booked / d.total) * 100 : 0;
          return (
            <button
              key={d.date}
              type="button"
              onMouseEnter={() => setFocus(i)}
              onMouseLeave={() => setFocus(null)}
              onFocus={() => setFocus(i)}
              onBlur={() => setFocus(null)}
              aria-label={`${d.weekday} ${d.label}: ${d.total} calls, ${d.booked} booked`}
              className="group flex h-full flex-1 flex-col justify-end rounded-md focus-visible:outline-offset-4"
            >
              <span className="sr-only">{d.label}</span>
              {d.total === 0 ? (
                <span className="block h-1 w-full rounded-full bg-slate-200" />
              ) : (
                <span
                  className={`flex w-full flex-col-reverse overflow-hidden rounded-md border-2 border-brand-300 bg-brand-50 transition-opacity ${focus !== null && focus !== i ? 'opacity-50' : ''}`}
                  style={{ height: `${Math.max(totalPct, 6)}%` }}
                >
                  <span className="block w-full bg-brand-600" style={{ height: `${bookedPct}%` }} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1.5 sm:gap-2.5" aria-hidden>
        {days.map((d, i) => (
          <span key={d.date} className={`flex-1 text-center text-[11px] ${i % 2 ? 'hidden sm:block' : ''} ${focus === i ? 'font-semibold text-ink' : 'text-slate-400'}`}>
            {i === DAYS - 1 ? 'Today' : d.label.replace(/^\w+ /, '')}
          </span>
        ))}
      </div>

      <table className="sr-only">
        <caption>Calls per day, last {DAYS} days</caption>
        <thead><tr><th>Day</th><th>Calls</th><th>Booked</th></tr></thead>
        <tbody>{days.map((d) => <tr key={d.date}><td>{d.weekday} {d.label}</td><td>{d.total}</td><td>{d.booked}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
