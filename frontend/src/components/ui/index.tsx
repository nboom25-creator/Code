import { type ButtonHTMLAttributes, type ReactNode } from 'react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ------------------------------------------------------------------ Button

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  variant = 'secondary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const styles: Record<ButtonVariant, string> = {
    primary:
      'bg-sky-500 hover:bg-sky-400 text-slate-950 font-medium disabled:bg-slate-700 disabled:text-slate-500',
    secondary:
      'bg-slate-700 hover:bg-slate-600 text-slate-100 disabled:bg-slate-800 disabled:text-slate-600',
    danger: 'bg-red-600/80 hover:bg-red-500 text-white disabled:bg-slate-800 disabled:text-slate-600',
    ghost: 'bg-transparent hover:bg-slate-700/60 text-slate-300 disabled:text-slate-600',
  };
  return (
    <button
      className={cx(
        'rounded px-2.5 py-1.5 text-sm transition-colors disabled:cursor-not-allowed',
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}

// ------------------------------------------------------------------ Alert

export function Alert({
  kind = 'error',
  title,
  children,
  className,
}: {
  kind?: 'error' | 'warning' | 'info' | 'success';
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const styles = {
    error: 'border-red-500/50 bg-red-950/40 text-red-200',
    warning: 'border-amber-500/50 bg-amber-950/40 text-amber-200',
    info: 'border-sky-500/50 bg-sky-950/40 text-sky-200',
    success: 'border-emerald-500/50 bg-emerald-950/40 text-emerald-200',
  };
  return (
    <div className={cx('rounded border px-3 py-2 text-sm', styles[kind], className)}>
      {title && <div className="mb-0.5 font-semibold">{title}</div>}
      <div className="whitespace-pre-wrap break-words">{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------ Badge

export function Badge({
  color = 'slate',
  children,
  title,
  className,
}: {
  color?: 'slate' | 'sky' | 'green' | 'amber' | 'red' | 'purple' | 'cyan' | 'orange' | 'yellow' | 'blue';
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  const styles: Record<string, string> = {
    slate: 'bg-slate-700/70 text-slate-300',
    sky: 'bg-sky-500/20 text-sky-300',
    green: 'bg-emerald-500/20 text-emerald-300',
    amber: 'bg-amber-500/20 text-amber-300',
    red: 'bg-red-500/20 text-red-300',
    purple: 'bg-purple-500/20 text-purple-300',
    cyan: 'bg-cyan-500/20 text-cyan-300',
    orange: 'bg-orange-500/20 text-orange-300',
    yellow: 'bg-yellow-500/20 text-yellow-300',
    blue: 'bg-blue-500/20 text-blue-300',
  };
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium',
        styles[color],
        className,
      )}
    >
      {children}
    </span>
  );
}

// ------------------------------------------------------------------ Panel / Section

export function Panel({
  title,
  children,
  actions,
  className,
}: {
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('rounded-lg border border-slate-700/70 bg-slate-800 p-3', className)}>
      {(title || actions) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          {title && <h3 className="text-sm font-semibold text-slate-100">{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function Collapsible({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="cursor-pointer select-none text-xs text-sky-300 hover:text-sky-200">
        {label}
      </summary>
      <div className="mt-1.5 border-l border-slate-700 pl-2 text-xs text-slate-300">{children}</div>
    </details>
  );
}

// ------------------------------------------------------------------ Form bits

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block font-medium text-slate-400">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-400 focus:outline-none';

export const selectCls = inputCls;

// ------------------------------------------------------------------ Progress

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded bg-slate-700', className)}>
      <div
        className="h-full rounded bg-sky-400 transition-[width] duration-300"
        style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
      />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        'inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-500 border-t-sky-400',
        className,
      )}
    />
  );
}

// ------------------------------------------------------------------ Term with tooltip

export function Term({ text, tip }: { text: string; tip: string }) {
  return (
    <span title={tip} className="cursor-help underline decoration-dotted decoration-slate-500 underline-offset-2">
      {text}
    </span>
  );
}

// ------------------------------------------------------------------ Key/value table

export function KVTable({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <table className="w-full text-xs">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-slate-700/50 last:border-0">
            <td className="py-1 pr-2 align-top text-slate-400">{r[0]}</td>
            <td className="py-1 text-right font-mono text-slate-200">{r[1]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ------------------------------------------------------------------ Empty state

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-700 p-4 text-center">
      <div className="text-sm font-medium text-slate-300">{title}</div>
      {children && <div className="mt-1 text-xs text-slate-500">{children}</div>}
    </div>
  );
}
