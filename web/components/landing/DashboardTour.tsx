'use client';

// Tabs that switch between dashboard screenshots. Arrow keys move between tabs (WAI-ARIA tabs pattern).
import { useRef, useState } from 'react';
import Image from 'next/image';

const SHOTS = [
  { id: 'call', label: 'A call', src: '/landing/call-detail.webp', alt: 'A single call: the caller details next to the full conversation, with a button to call the customer back', text: "The whole conversation next to the details. If they still need a call back, their number's right at the top." },
  { id: 'calls', label: 'Call log', src: '/landing/calls.webp', alt: 'Calls page: a list of calls with caller, car, problem and outcome', text: 'Every call, newest first, with who rang, what they drive and how it ended.' },
  { id: 'bookings', label: 'Bookings', src: '/landing/bookings.webp', alt: 'Bookings page: upcoming appointments with status and actions', text: 'Mark a job done or a no-show, or cancel it with a reason. Filter by day or status.' },
  { id: 'settings', label: 'Settings', src: '/landing/settings.webp', alt: 'Settings page: opening hours for each weekday, bays and appointment length', text: 'Hours for each day, closed days, bays and slot length. The next call uses whatever you save here.' }
];

export function DashboardTour() {
  const [index, setIndex] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const shot = SHOTS[index];

  function onKeyDown(event: React.KeyboardEvent) {
    const move = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? SHOTS.length - 1 : move ? (index + move + SHOTS.length) % SHOTS.length : null;
    if (to === null) return;
    event.preventDefault();
    setIndex(to);
    tabs.current[to]?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label="Dashboard pages" onKeyDown={onKeyDown} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:justify-center sm:px-0">
        {SHOTS.map((s, i) => (
          <button
            key={s.id}
            ref={(el) => { tabs.current[i] = el; }}
            role="tab"
            id={`tab-${s.id}`}
            aria-selected={i === index}
            aria-controls="tour-panel"
            tabIndex={i === index ? 0 : -1}
            onClick={() => setIndex(i)}
            className={`h-11 shrink-0 rounded-full px-5 text-sm font-semibold transition-colors duration-150 ${
              i === index ? 'bg-ink text-white' : 'bg-white text-ink-muted ring-1 ring-line hover:text-ink hover:ring-slate-300'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="tour-panel" aria-labelledby={`tab-${shot.id}`} className="mt-8">
        <p className="mx-auto max-w-xl text-center text-ink-muted">{shot.text}</p>
        <div className="mt-8 overflow-hidden rounded-2xl border border-line bg-white shadow-2xl shadow-slate-900/10">
          <div aria-hidden className="flex items-center gap-1.5 border-b border-line bg-slate-50 px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          </div>
          <Image key={shot.id} src={shot.src} alt={shot.alt} width={1600} height={1000} sizes="(min-width: 1152px) 1104px, 100vw" className="h-auto w-full" />
        </div>
      </div>
    </div>
  );
}
