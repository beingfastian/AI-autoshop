'use client';

import { useEffect, useState } from 'react';
import { useMe } from '@/components/Shell';
import { Card, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { api, ApiError, type Closure, type DayHours, type Workshop } from '@/lib/api';
import { formatPhone } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const US_ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];

type Form = {
  name: string;
  address: string;
  phone: string;
  transfer_phone: string;
  timezone: string;
  slot_minutes: number;
  bay_count: number;
  min_notice_minutes: number;
  notify_emails: string;
  hours: Record<string, { closed: boolean; open: string; close: string }>;
};

function toForm(w: Workshop): Form {
  const hours: Form['hours'] = {};
  for (const day of DAYS) {
    const h = w.business_hours?.[day] as DayHours | undefined;
    hours[day] = h && !('closed' in h) ? { closed: false, open: h.open, close: h.close } : { closed: true, open: '08:00', close: '17:00' };
  }
  return {
    name: w.name, address: w.address || '', phone: w.phone, transfer_phone: w.transfer_phone || '', timezone: w.timezone,
    slot_minutes: w.slot_minutes, bay_count: w.bay_count, min_notice_minutes: w.min_notice_minutes,
    notify_emails: (w.notify_emails || []).join(', '), hours
  };
}

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

function Closures({ canEdit }: { canEdit: boolean }) {
  const { data, error, reload } = useLoad(() => api<{ closures: Closure[] }>('/workshop/closures'));
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setProblem(null);
    try {
      await api('/workshop/closures', { method: 'POST', json: { starts_on: start, ends_on: end || start, reason: reason || null } });
      setStart(''); setEnd(''); setReason('');
      reload();
    } catch (e) {
      setProblem(e instanceof ApiError ? [e.message, ...e.details].join(' · ') : 'Could not add the closure');
    }
  }

  async function remove(c: Closure) {
    if (!window.confirm(`Reopen ${c.starts_on}${c.ends_on !== c.starts_on ? ` to ${c.ends_on}` : ''}? The AI will offer these days again.`)) return;
    await api(`/workshop/closures/${c.id}`, { method: 'DELETE' }).catch((e) => setProblem(e.message));
    reload();
  }

  return (
    <Card className="p-6">
      <h2 className="font-semibold">Closed days</h2>
      <p className="mt-1 text-sm text-gray-500">Holidays and other days the AI must not book (shop&apos;s local dates).</p>
      {error && <div className="mt-3"><ErrorBox error={error} onRetry={reload} /></div>}
      <ul className="mt-4 divide-y divide-gray-100 text-sm">
        {(data?.closures || []).map((c) => (
          <li key={c.id} className="flex items-center justify-between py-2">
            <span>
              <span className="font-medium">{c.starts_on}{c.ends_on !== c.starts_on ? ` → ${c.ends_on}` : ''}</span>
              {c.reason && <span className="text-gray-500"> · {c.reason}</span>}
            </span>
            {canEdit && <button onClick={() => remove(c)} className="font-medium text-red-700 hover:underline">Remove</button>}
          </li>
        ))}
        {data && data.closures.length === 0 && <li className="py-2 text-gray-500">No upcoming closed days.</li>}
      </ul>
      {canEdit && (
        <form onSubmit={add} className="mt-4 grid gap-3 sm:grid-cols-4">
          <input type="date" required value={start} onChange={(e) => setStart(e.target.value)} className={input} aria-label="First closed day" />
          <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className={input} aria-label="Last closed day (optional)" />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" maxLength={255} className={input} />
          <button type="submit" disabled={!start} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">Add closed days</button>
        </form>
      )}
      {problem && <p role="alert" className="mt-3 text-sm text-red-700">{problem}</p>}
    </Card>
  );
}

export default function SettingsPage() {
  const { user } = useMe();
  const canEdit = user.role === 'owner' || user.role === 'admin';
  const { data, error, loading, reload } = useLoad(() => api<Workshop>('/workshop'));
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string; details?: string[] } | null>(null);

  useEffect(() => {
    if (data) setForm(toForm(data));
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!form || !data) return null;

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm({ ...form, [key]: value });
  const setDay = (day: string, change: Partial<Form['hours'][string]>) =>
    setForm({ ...form, hours: { ...form.hours, [day]: { ...form.hours[day], ...change } } });
  const zones = US_ZONES.includes(form.timezone) ? US_ZONES : [form.timezone, ...US_ZONES];

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setMessage(null);
    const business_hours = Object.fromEntries(
      DAYS.map((d) => [d, form.hours[d].closed ? { closed: true } : { open: form.hours[d].open, close: form.hours[d].close }])
    );
    try {
      const saved = await api<Workshop>('/workshop', {
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
          business_hours
        }
      });
      setForm(toForm(saved));
      setMessage({ ok: true, text: 'Saved. The AI uses the new settings from the next call.' });
    } catch (e) {
      setMessage(e instanceof ApiError ? { ok: false, text: e.message, details: e.details } : { ok: false, text: 'Could not save' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={canEdit ? 'What the AI receptionist knows about your shop' : 'Only the shop owner can change these settings'}
      />
      <form onSubmit={save} className="space-y-6">
        <fieldset disabled={!canEdit || saving} className="space-y-6">
          <Card className="grid gap-5 p-6 sm:grid-cols-2">
            <Field label="Shop name"><input className={input} value={form.name} onChange={(e) => set('name', e.target.value)} required maxLength={255} /></Field>
            <Field label="Shop phone"><input className={input} value={form.phone} onChange={(e) => set('phone', e.target.value)} required /></Field>
            <Field label="Address" hint="The AI tells callers where to come"><input className={input} value={form.address} onChange={(e) => set('address', e.target.value)} maxLength={500} /></Field>
            <Field label="Timezone">
              <select className={input} value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
                {zones.map((z) => <option key={z} value={z}>{z.replace('_', ' ')}</option>)}
              </select>
            </Field>
            <Field label="Transfer calls to" hint="When a caller asks for a person. Leave empty to offer a call back instead.">
              <input className={input} value={form.transfer_phone} onChange={(e) => set('transfer_phone', e.target.value)} placeholder="(555) 123-4567" />
            </Field>
            <Field label="Also email new bookings to" hint="Comma-separated, up to 10">
              <input className={input} value={form.notify_emails} onChange={(e) => set('notify_emails', e.target.value)} placeholder="manager@yourshop.com" />
            </Field>
            <p className="text-xs text-gray-500 sm:col-span-2">AI phone number: {data.ai_phone_number ? formatPhone(data.ai_phone_number) : 'not set up yet'}</p>
          </Card>

          <Card className="p-6">
            <h2 className="font-semibold">Opening hours</h2>
            <p className="mt-1 text-sm text-gray-500">The AI only offers times inside these hours.</p>
            <div className="mt-4 divide-y divide-gray-100">
              {DAYS.map((day) => {
                const h = form.hours[day];
                return (
                  <div key={day} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className="w-28 text-sm font-medium capitalize">{day}</span>
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                      <input type="checkbox" checked={!h.closed} onChange={(e) => setDay(day, { closed: !e.target.checked })} className="h-4 w-4 rounded border-gray-300" />
                      Open
                    </label>
                    {!h.closed && (
                      <>
                        <input type="time" value={h.open} onChange={(e) => setDay(day, { open: e.target.value })} className="rounded-lg border border-gray-300 px-2 py-1 text-sm" aria-label={`${day} opens`} />
                        <span className="text-gray-400">to</span>
                        <input type="time" value={h.close} onChange={(e) => setDay(day, { close: e.target.value })} className="rounded-lg border border-gray-300 px-2 py-1 text-sm" aria-label={`${day} closes`} />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="grid gap-5 p-6 sm:grid-cols-3">
            <Field label="Appointment length (minutes)" hint="15 to 480"><input type="number" min={15} max={480} className={input} value={form.slot_minutes} onChange={(e) => set('slot_minutes', Number(e.target.value))} /></Field>
            <Field label="Service bays" hint="Appointments that can run at the same time"><input type="number" min={1} max={100} className={input} value={form.bay_count} onChange={(e) => set('bay_count', Number(e.target.value))} /></Field>
            <Field label="Minimum notice (minutes)" hint="How soon before an appointment it can still be booked"><input type="number" min={0} max={10080} className={input} value={form.min_notice_minutes} onChange={(e) => set('min_notice_minutes', Number(e.target.value))} /></Field>
          </Card>
        </fieldset>

        {message && (
          <div role="status" className={`rounded-xl p-4 text-sm ${message.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
            {message.text}
            {message.details && message.details.length > 0 && <ul className="mt-2 list-disc pl-5">{message.details.map((d) => <li key={d}>{d}</li>)}</ul>}
          </div>
        )}
        {canEdit && (
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-5 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save settings'}</button>
            <button type="button" disabled={saving} onClick={() => { setForm(toForm(data)); setMessage(null); }} className="rounded-lg px-4 py-2.5 font-medium text-gray-600 hover:bg-gray-100">Discard changes</button>
          </div>
        )}
      </form>
      <div className="mt-8"><Closures canEdit={canEdit} /></div>
    </>
  );
}
