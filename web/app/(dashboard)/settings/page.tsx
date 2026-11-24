'use client';

import { useEffect, useState } from 'react';
import { Building2, CalendarX, CircleAlert, CircleCheck, Clock, Lock, Mail, Plus, RotateCcw, Save, Trash2, Wrench } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useMe } from '@/components/Shell';
import { Button, Card, CardHeader, ErrorBox, PageHeader, Skeleton } from '@/components/ui';
import { api, ApiError, type Closure, type DayHours, type Workshop } from '@/lib/api';
import { formatPhone } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const US_ZONES: [string, string][] = [
  ['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'],
  ['America/Phoenix', 'Arizona'], ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii']
];

type Form = {
  name: string; address: string; phone: string; transfer_phone: string; timezone: string;
  slot_minutes: number; bay_count: number; min_notice_minutes: number; notify_emails: string;
  hours: Record<string, { closed: boolean; open: string; close: string }>;
};

function toForm(w: Workshop): Form {
  const hours: Form['hours'] = {};
  for (const day of DAYS) {
    const h = w.business_hours?.[day] as DayHours | undefined;
    hours[day] = h && !('closed' in h) ? { closed: false, open: h.open, close: h.close } : { closed: true, open: '08:00', close: '17:00' };
  }
  return {
    name: w.name, address: w.address || '', phone: formatPhone(w.phone), transfer_phone: w.transfer_phone ? formatPhone(w.transfer_phone) : '', timezone: w.timezone,
    slot_minutes: w.slot_minutes, bay_count: w.bay_count, min_notice_minutes: w.min_notice_minutes,
    notify_emails: (w.notify_emails || []).join(', '), hours
  };
}

const inputClass =
  'block h-11 w-full rounded-xl border border-line bg-white px-3.5 text-sm text-ink shadow-sm transition-colors placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-ink-muted';

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold text-ink">{label}</label>
      <div className="mt-2">{children}</div>
      {hint && <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

/** A unit shown inside the right edge of a number field (decorative; the label and hint say it too) */
function Suffixed({ unit, children }: { unit: string; children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-ink-muted">{unit}</span>
    </div>
  );
}

/** Accessible on/off switch (role="switch") with a visible text state */
function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-brand-600' : 'bg-slate-300'}`}
    >
      <span aria-hidden className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  );
}

function Closures({ canEdit }: { canEdit: boolean }) {
  const { data, error, reload } = useLoad(() => api<{ closures: Closure[] }>('/workshop/closures'));
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Closure | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setProblem(null);
    setAdding(true);
    try {
      await api('/workshop/closures', { method: 'POST', json: { starts_on: start, ends_on: end || start, reason: reason || null } });
      setStart(''); setEnd(''); setReason('');
      reload();
    } catch (e) {
      setProblem(e instanceof ApiError ? [e.message, ...e.details].join(' · ') : 'Could not add the closed days');
    } finally {
      setAdding(false);
    }
  }

  const range = (c: Closure) => {
    const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    return c.ends_on !== c.starts_on ? `${fmt(c.starts_on)} – ${fmt(c.ends_on)}` : fmt(c.starts_on);
  };

  return (
    <Card>
      <CardHeader icon={CalendarX} title="Closed days" description="Holidays and other days the AI won't offer appointments." />
      <div className="p-5 sm:p-6">
        {error && <ErrorBox error={error} onRetry={reload} />}
        {data && data.closures.length === 0 && <p className="text-sm text-ink-muted">No upcoming closed days.</p>}
        {data && data.closures.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {data.closures.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{range(c)}</p>
                  {c.reason && <p className="truncate text-sm text-ink-muted">{c.reason}</p>}
                </div>
                {canEdit && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setRemoving(c)} aria-label={`Reopen ${range(c)}`}>Reopen</Button>}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <form onSubmit={add} className="mt-5 grid gap-4 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-end">
            <Field id="closure-start" label="From"><input id="closure-start" type="date" required value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} /></Field>
            <Field id="closure-end" label="To (optional)"><input id="closure-end" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className={inputClass} /></Field>
            <Field id="closure-reason" label="Reason (optional)"><input id="closure-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Thanksgiving" maxLength={255} className={inputClass} /></Field>
            <Button type="submit" variant="secondary" icon={Plus} loading={adding} disabled={!start}>Add</Button>
          </form>
        )}
        {problem && <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-red-700"><CircleAlert aria-hidden className="h-4 w-4" />{problem}</p>}
      </div>
      <ConfirmDialog
        options={removing && { title: 'Reopen these days?', message: <>The AI will offer appointments on {range(removing)} again.</>, confirmLabel: 'Reopen' }}
        onConfirm={async () => {
          if (!removing) return;
          await api(`/workshop/closures/${removing.id}`, { method: 'DELETE' }).catch((e) => setProblem(e.message));
          setRemoving(null);
          reload();
        }}
        onClose={() => setRemoving(null)}
      />
    </Card>
  );
}

export default function SettingsPage() {
  const { user } = useMe();
  const canEdit = user.role === 'owner' || user.role === 'admin';
  const { data, error, loading, reload } = useLoad(() => api<Workshop>('/workshop'));
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; details?: string[] } | null>(null);

  useEffect(() => {
    if (data) {
      setForm(toForm(data));
      setSaved(toForm(data));
    }
  }, [data]);

  const dirty = Boolean(form && saved && JSON.stringify(form) !== JSON.stringify(saved));

  // Warn before leaving with unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (error) return <><PageHeader title="Settings" /><ErrorBox error={error} onRetry={reload} /></>;
  if (loading || !form || !data) {
    return (
      <><PageHeader title="Settings" />
        <div role="status" className="space-y-6"><span className="sr-only">Loading settings…</span><Skeleton className="h-64 rounded-2xl" /><Skeleton className="h-80 rounded-2xl" /></div>
      </>
    );
  }

  const set = <K extends keyof Form>(key: K, value: Form[K]) => { setForm({ ...form, [key]: value }); setResult(null); };
  const setDay = (day: string, change: Partial<Form['hours'][string]>) => {
    setForm({ ...form, hours: { ...form.hours, [day]: { ...form.hours[day], ...change } } });
    setResult(null);
  };
  const zones = US_ZONES.some(([z]) => z === form.timezone) ? US_ZONES : [[form.timezone, form.timezone] as [string, string], ...US_ZONES];

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setResult(null);
    try {
      const updated = await api<Workshop>('/workshop', {
        method: 'PUT',
        json: {
          name: form.name,
          address: form.address || null,
          phone: form.phone,
          transfer_phone: form.transfer_phone || null,
          timezone: form.timezone,
          slot_minutes: Number(form.slot_minutes),
          bay_count: Number(form.bay_count),
          min_notice_minutes: Number(form.min_notice_minutes),
          notify_emails: form.notify_emails.split(',').map((e) => e.trim()).filter(Boolean),
          business_hours: Object.fromEntries(DAYS.map((d) => [d, form.hours[d].closed ? { closed: true } : { open: form.hours[d].open, close: form.hours[d].close }]))
        }
      });
      setForm(toForm(updated));
      setSaved(toForm(updated));
      setResult({ ok: true, text: 'Settings saved. Your AI receptionist uses them from the next call.' });
    } catch (e) {
      setResult(e instanceof ApiError ? { ok: false, text: e.message, details: e.details } : { ok: false, text: 'Could not save. Check your connection and try again.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Settings" description="What your AI receptionist knows about your shop, and when it can book." />

      {!canEdit && (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-line bg-white p-4 text-sm text-ink-muted">
          <Lock aria-hidden className="h-4 w-4 shrink-0" /> Only the shop owner can change these settings.
        </div>
      )}

      <form onSubmit={save} className={`space-y-6 ${dirty ? 'pb-24' : ''}`}>
        <fieldset disabled={!canEdit || saving} className="space-y-6">
          <Card>
            <CardHeader icon={Building2} title="Shop details" description="Shared with callers by the AI." />
            <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-2 sm:p-6">
              <Field id="name" label="Shop name"><input id="name" className={inputClass} value={form.name} onChange={(e) => set('name', e.target.value)} required maxLength={255} /></Field>
              <Field id="phone" label="Main phone number"><input id="phone" type="tel" className={inputClass} value={form.phone} onChange={(e) => set('phone', e.target.value)} required /></Field>
              <div className="sm:col-span-2">
                <Field id="address" label="Address" hint="The AI tells callers where to bring their car."><input id="address" aria-describedby="address-hint" className={inputClass} value={form.address} onChange={(e) => set('address', e.target.value)} maxLength={500} placeholder="123 Main St, Springfield, IL 62701" /></Field>
              </div>
              <Field id="timezone" label="Timezone" hint="All appointment times use this timezone.">
                <select id="timezone" aria-describedby="timezone-hint" className={inputClass} value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
                  {zones.map(([z, label]) => <option key={z} value={z}>{label} time ({z.split('/')[1].replace('_', ' ')})</option>)}
                </select>
              </Field>
              <Field id="ai-number" label="AI phone number" hint="Customers call this number to reach your AI receptionist.">
                <input id="ai-number" aria-describedby="ai-number-hint" className={inputClass} value={data.ai_phone_number ? formatPhone(data.ai_phone_number) : 'Not set up yet'} readOnly disabled />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader icon={Clock} title="Opening hours" description="The AI only offers appointment times inside these hours." />
            <ul className="divide-y divide-line">
              {DAYS.map((day) => {
                const h = form.hours[day];
                const name = day[0].toUpperCase() + day.slice(1);
                return (
                  <li key={day} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3.5 sm:px-6">
                    <div className="flex w-40 items-center gap-3">
                      <Switch checked={!h.closed} onChange={(v) => setDay(day, { closed: !v })} label={`Open on ${name}`} disabled={!canEdit} />
                      <span className="font-semibold text-ink">{name}</span>
                    </div>
                    {h.closed ? (
                      <span className="text-sm text-ink-muted">Closed</span>
                    ) : (
                      <div className="flex items-center gap-2.5">
                        <input type="time" value={h.open} onChange={(e) => setDay(day, { open: e.target.value })} className={`${inputClass} h-10 w-32`} aria-label={`${name} opens at`} />
                        <span className="text-sm text-ink-muted">to</span>
                        <input type="time" value={h.close} onChange={(e) => setDay(day, { close: e.target.value })} className={`${inputClass} h-10 w-32`} aria-label={`${name} closes at`} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <CardHeader icon={Wrench} title="Scheduling" description="How the AI fills your schedule." />
            <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-3 sm:p-6">
              <Field id="slot" label="Appointment length" hint="Minutes per booking (15–480).">
                <Suffixed unit="min"><input id="slot" aria-describedby="slot-hint" type="number" min={15} max={480} step={5} className={`${inputClass} pr-14`} value={form.slot_minutes} onChange={(e) => set('slot_minutes', Number(e.target.value))} /></Suffixed>
              </Field>
              <Field id="bays" label="Service bays" hint="Cars you can work on at the same time.">
                <Suffixed unit="bays"><input id="bays" aria-describedby="bays-hint" type="number" min={1} max={100} className={`${inputClass} pr-16`} value={form.bay_count} onChange={(e) => set('bay_count', Number(e.target.value))} /></Suffixed>
              </Field>
              <Field id="notice" label="Minimum notice" hint="Minutes before a slot that it can still be booked.">
                <Suffixed unit="min"><input id="notice" aria-describedby="notice-hint" type="number" min={0} max={10080} step={15} className={`${inputClass} pr-14`} value={form.min_notice_minutes} onChange={(e) => set('min_notice_minutes', Number(e.target.value))} /></Suffixed>
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader icon={Mail} title="Calls and notifications" description="Where people and alerts go." />
            <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-2 sm:p-6">
              <Field id="transfer" label="Transfer to a person" hint="When a caller asks for a human. Leave empty to offer a call back instead.">
                <input id="transfer" aria-describedby="transfer-hint" type="tel" className={inputClass} value={form.transfer_phone} onChange={(e) => set('transfer_phone', e.target.value)} placeholder="(555) 123-4567" />
              </Field>
              <Field id="emails" label="Also email new bookings to" hint="Comma-separated, up to 10. Your shop email always gets them.">
                <input id="emails" aria-describedby="emails-hint" className={inputClass} value={form.notify_emails} onChange={(e) => set('notify_emails', e.target.value)} placeholder="manager@yourshop.com" />
              </Field>
            </div>
          </Card>
        </fieldset>

        {result && (
          <div role="status" className={`flex items-start gap-3 rounded-2xl border p-4 text-sm ${result.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
            {result.ok ? <CircleCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0" /> : <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />}
            <div>
              <p className="font-semibold">{result.text}</p>
              {result.details && result.details.length > 0 && <ul className="mt-1.5 list-disc space-y-0.5 pl-5">{result.details.map((d) => <li key={d}>{d}</li>)}</ul>}
            </div>
          </div>
        )}

        {canEdit && dirty && (
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 backdrop-blur lg:left-64">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-10">
              <p className="text-sm font-medium text-ink">You have unsaved changes</p>
              <div className="flex gap-3">
                <Button type="button" variant="secondary" icon={RotateCcw} disabled={saving} onClick={() => { if (saved) setForm(saved); setResult(null); }}>Discard</Button>
                <Button type="submit" icon={Save} loading={saving}>Save changes</Button>
              </div>
            </div>
          </div>
        )}
      </form>

      <div className="mt-6"><Closures canEdit={canEdit} /></div>
    </>
  );
}
