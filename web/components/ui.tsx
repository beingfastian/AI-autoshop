// Shared UI building blocks. Icons are Lucide SVGs (never emoji); decorative icons are
// aria-hidden, and anything clickable has a visible text label or an aria-label.
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { CircleAlert, Loader2, RotateCcw } from 'lucide-react';

// ---------- Badges ----------

const TONES = {
  gray: { box: 'bg-slate-100 text-slate-700 ring-slate-500/15', dot: 'bg-slate-400' },
  blue: { box: 'bg-brand-50 text-brand-700 ring-brand-600/20', dot: 'bg-brand-600' },
  green: { box: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', dot: 'bg-emerald-500' },
  orange: { box: 'bg-attention-50 text-attention-700 ring-attention-600/25', dot: 'bg-attention-600' },
  red: { box: 'bg-red-50 text-red-700 ring-red-600/20', dot: 'bg-red-500' }
} as const;
export type Tone = keyof typeof TONES;

/** Status pill. The dot and the text both carry the meaning, so colour is never the only cue. */
export function Badge({ tone = 'gray', dot = true, children }: { tone?: Tone; dot?: boolean; children: React.ReactNode }) {
  const t = TONES[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${t.box}`}>
      {dot && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />}
      {children}
    </span>
  );
}

export const BOOKING_TONE: Record<string, Tone> = {
  confirmed: 'blue', pending: 'orange', completed: 'green', cancelled: 'gray', no_show: 'red'
};

// ---------- Surfaces and layout ----------

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}>{children}</div>;
}

export function CardHeader({ title, description, icon: Icon, action }: { title: string; description?: string; icon?: LucideIcon; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span aria-hidden className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}

// ---------- Buttons ----------

const BUTTON = {
  primary: 'bg-brand-600 text-white shadow-sm hover:bg-brand-700',
  secondary: 'border border-line bg-white text-ink shadow-sm hover:bg-slate-50',
  ghost: 'text-ink-muted hover:bg-slate-100 hover:text-ink',
  danger: 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
  dangerSolid: 'bg-red-600 text-white shadow-sm hover:bg-red-700'
} as const;

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BUTTON;
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  loading?: boolean;
};

export function Button({ variant = 'primary', size = 'md', icon: Icon, loading, children, className = '', disabled, ...rest }: ButtonProps) {
  const sizing = size === 'sm' ? 'h-9 px-3 text-sm' : 'h-11 px-4 text-sm';
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${BUTTON[variant]} ${className}`}
    >
      {loading ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : Icon && <Icon aria-hidden className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="whitespace-nowrap text-sm font-semibold text-brand-600 transition-colors hover:text-brand-700">{children}</Link>;
}

// ---------- People ----------

const AVATAR_COLORS = ['bg-brand-100 text-brand-700', 'bg-emerald-100 text-emerald-700', 'bg-violet-100 text-violet-700', 'bg-amber-100 text-amber-800', 'bg-sky-100 text-sky-700', 'bg-rose-100 text-rose-700'];

export function Avatar({ name, size = 'md' }: { name: string | null | undefined; size?: 'sm' | 'md' }) {
  const label = (name || '?').trim();
  const initials = label.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || '?';
  const color = AVATAR_COLORS[[...label].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  const dims = size === 'sm' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm';
  return <span aria-hidden className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${dims} ${color}`}>{initials}</span>;
}

// ---------- States ----------

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-slate-200/70 ${className}`} />;
}

/** Placeholder rows while data loads, so the layout doesn't jump when it arrives */
export function LoadingRows({ rows = 5, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="divide-y divide-line">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4 sm:px-6">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <CircleAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="flex-1">
        <p className="font-semibold">Something went wrong</p>
        <p className="mt-0.5">{error}</p>
      </div>
      {onRetry && <Button variant="secondary" size="sm" icon={RotateCcw} onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Empty({ icon: Icon, title, hint, action }: { icon: LucideIcon; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
        <Icon className="h-6 w-6" />
      </span>
      <p className="mt-4 font-semibold text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-ink-muted">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ---------- Tables ----------

export const TH = 'whitespace-nowrap px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 sm:px-6';
export const TD = 'px-5 py-4 align-middle sm:px-6';

export function Pagination({ page, pages, onChange, labels = ['Previous', 'Next'] }: { page: number; pages: number; onChange: (page: number) => void; labels?: [string, string] }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between border-t border-line px-5 py-3 sm:px-6">
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>{labels[0]}</Button>
      <span className="text-sm text-ink-muted">Page <span className="font-semibold text-ink">{page}</span> of {pages}</span>
      <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>{labels[1]}</Button>
    </nav>
  );
}
