import { PhoneCall } from 'lucide-react';
import { BRAND_NAME } from '@/lib/brand';

/** Product mark + name. `tone="light"` for dark backgrounds. */
export function Logo({ tone = 'dark', subtitle }: { tone?: 'dark' | 'light'; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm shadow-brand-600/30">
        <PhoneCall className="h-[18px] w-[18px]" strokeWidth={2.25} />
      </span>
      <div className="min-w-0 leading-tight">
        <p className={`truncate font-bold tracking-tight ${tone === 'light' ? 'text-white' : 'text-ink'}`}>{BRAND_NAME}</p>
        {subtitle && <p className={`truncate text-xs ${tone === 'light' ? 'text-brand-100' : 'text-ink-muted'}`}>{subtitle}</p>}
      </div>
    </div>
  );
}
