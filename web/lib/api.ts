// Typed client for the API (same origin: next.config.ts forwards /api/* to the API server, so the
// session cookie is sent automatically). A 401 means the session ended: go back to sign-in.

export class ApiError extends Error {
  constructor(message: string, public status: number, public details: string[] = []) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const response = await fetch(`/api${path}`, {
    ...rest,
    credentials: 'same-origin',
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body
  });
  const data = await response.json().catch(() => ({}));

  if (response.status === 401 && !path.startsWith('/auth/login')) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new ApiError('Please sign in', 401);
  }
  if (!response.ok) {
    throw new ApiError(data.error || `Request failed (${response.status})`, response.status, data.details || []);
  }
  return data as T;
}

// ---- Shapes returned by the API ----

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: 'owner' | 'staff' | 'admin';
  workshop_id: string;
}

export interface Me {
  user: User;
  workshop: { id: string; name: string; timezone: string; status: string; ai_phone_number: string | null };
}

export interface CallSummary {
  id: string;
  from_number: string;
  status: string;
  started_at: string;
  duration_seconds: number | null;
  ended_reason: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  issue_summary: string | null;
  booking_created: boolean | null;
  callback_requested: boolean | null;
}

export interface CallDetail extends CallSummary {
  workshop_name: string;
  transcript: string | null;
  recording_url: string | null;
  sentiment: string | null;
  structured_data: { summary?: string | null } & Record<string, unknown> | null;
}

export interface Booking {
  id: string;
  scheduled_at: string;
  duration_minutes: number | null;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  urgency: 'urgent' | 'normal' | 'low';
  issue_summary: string;
  issue_category: string;
  call_id: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
}

export type DayHours = { open: string; close: string } | { closed: true };

export interface Workshop {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string | null;
  timezone: string;
  business_hours: Record<string, DayHours>;
  slot_minutes: number;
  bay_count: number;
  min_notice_minutes: number;
  transfer_phone: string | null;
  notify_emails: string[];
  notify_sms: string[];
  ai_phone_number: string | null;
  status: string;
}

export interface Closure {
  id: string;
  starts_on: string;
  ends_on: string;
  reason: string | null;
}
