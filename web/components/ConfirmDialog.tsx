'use client';

// Confirmation dialog on the native <dialog> element: focus moves into it and back, Escape
// closes it, and the page behind can't be clicked (showModal). Optional text field for reasons.
import { useEffect, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from './ui';

export interface ConfirmOptions {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Shows a text field; its value is passed to onConfirm */
  inputLabel?: string;
}

export function ConfirmDialog({ options, onConfirm, onClose }: {
  options: ConfirmOptions | null;
  onConfirm: (input: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (options && !dialog.open) {
      setInput('');
      dialog.showModal();
    } else if (!options && dialog.open) {
      dialog.close();
    }
  }, [options]);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm(input.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="confirm-title"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-line bg-white p-0 text-ink shadow-2xl backdrop:bg-slate-900/40 backdrop:backdrop-blur-[2px]"
    >
      {options && (
        <form method="dialog" onSubmit={(e) => { e.preventDefault(); confirm(); }} className="p-6">
          <div className="flex items-start gap-4">
            {options.danger && (
              <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600"><TriangleAlert className="h-5 w-5" /></span>
            )}
            <div className="min-w-0 flex-1">
              <h2 id="confirm-title" className="text-lg font-semibold">{options.title}</h2>
              <div className="mt-1.5 text-sm text-ink-muted">{options.message}</div>
              {options.inputLabel && (
                <label className="mt-4 block">
                  <span className="text-sm font-semibold">{options.inputLabel}</span>
                  <input
                    autoFocus
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    maxLength={500}
                    className="mt-2 block h-11 w-full rounded-xl border border-line px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100"
                  />
                </label>
              )}
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Keep as is</Button>
            <Button type="submit" variant={options.danger ? 'dangerSolid' : 'primary'} loading={busy} autoFocus={!options.inputLabel}>{options.confirmLabel}</Button>
          </div>
        </form>
      )}
    </dialog>
  );
}
