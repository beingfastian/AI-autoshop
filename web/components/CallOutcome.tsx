import { Badge } from './ui';
import type { CallSummary } from '@/lib/api';

/** Booked / call back / in progress / no booking, for a call */
export function CallOutcome({ call }: { call: Pick<CallSummary, 'booking_created' | 'callback_requested' | 'status'> }) {
  if (call.booking_created) return <Badge tone="green">Booked</Badge>;
  if (call.callback_requested) return <Badge tone="amber">Call back</Badge>;
  if (call.status !== 'completed') return <Badge tone="blue">{call.status === 'in-progress' ? 'In progress' : 'Started'}</Badge>;
  return <Badge>No booking</Badge>;
}
