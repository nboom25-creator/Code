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
      'border border-sky-500/60 bg-gradient-to-b from-sky-500 to-sky-600 text-slate-950 font-semibold ' +
      'shadow-glow-cyan-soft hover:from-sky-400 hover:to-sky-500 ' +
      'disabled:border-slate-700 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 disabled:shadow-none',
    secondary:
      'border border-slate-600/70 bg-slate-800/90 text-slate-200 shadow-panel ' +
      'hover:border-sky-500/40 hover:bg-slate-700/80 hover:text-slate-100 ' +
      'disabled:border-slate-700/50 disabled:bg-slate-900 disabled:text-slate-500 disabled:shadow-none',
    danger:
      'border border-red-500/50 bg-red-500/15 text-red-300 hover:bg-red-500/25 hover:text-red-200 ' +
      'disabled:border-slate-700/50 disabled:bg-slate-900 disabled:text-slate-500',
    ghost:
      'border border-transparent bg-transparent text-slate-400 hover:border-slate-600/60 ' +
      'hover:bg-slate-800/70 hover:text-slate-200 disabled:text-slate-600',
  };
  return (
    <button
      className={cx(
        'rounded-md px-2.5 py-1.5 text-sm transition-all duration-150 disabled:cursor-not-allowed',
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
    error: 'border-l-red-500 bg-red-950/35 text-red-200 [--led:#FF5F6D]',
    warning: 'border-l-amber-500 bg-amber-950/35 text-amber-200 [--led:#FFBE55]',
    info: 'border-l-sky-500 bg-sky-950/35 text-sky-200 [--led:#23D5FF]',
    success: 'border-l-emerald-500 bg-emerald-950/35 text-emerald-200 [--led:#32E6A1]',
  };
  return (
    <div
      className={cx(
        'rounded-md border border-slate-700/50 border-l-2 px-3 py-2 text-sm backdrop-blur-sm',
        styles[kind],
        className,
      )}
    >
      {title && (
        <div className="mb-0.5 flex items-center gap-1.5 font-semibold">
          <span className="led" style={{ color: 'var(--led)' }} />
          {title}
        </div>
      )}
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
    slate: 'border-slate-600/60 bg-slate-800/80 text-slate-300',
    sky: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
    green: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    amber: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    red: 'border-red-500/40 bg-red-500/10 text-red-300',
    purple: 'border-purple-500/40 bg-purple-500/10 text-purple-300',
    cyan: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
    orange: 'border-orange-500/40 bg-orange-500/10 text-orange-300',
    yellow: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300',
    blue: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
  };
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-px',
        'text-[10px] font-medium uppercase tracking-wider',
        styles[color],
        className,
      )}
    >
      {children}
    </span>
  );
}

// ------------------------------------------------------------------ Status LED

export function StatusDot({
  tone,
  pulse = false,
  className,
}: {
  tone: 'idle' | 'running' | 'ok' | 'warn' | 'fail';
  pulse?: boolean;
  className?: string;
}) {
  const colors: Record<string, string> = {
    idle: 'text-slate-500',
    running: 'text-sky-400',
    ok: 'text-emerald-400',
    warn: 'text-amber-400',
    fail: 'text-red-400',
  };
  return (
    <span
      className={cx('led bg-current', colors[tone], pulse && 'animate-led-pulse', className)}
      aria-hidden
    />
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
    <div className={cx('lab-panel p-3', className)}>
      {(title || actions) && (
        <div className="mb-2.5 flex items-center justify-between gap-2">
          {title && (
            <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-techy text-slate-300">
              <span className="h-3 w-0.5 rounded-full bg-sky-500/80 shadow-glow-cyan-soft" />
              {title}
            </h3>
          )}
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
      <summary className="cursor-pointer select-none text-xs text-sky-300/90 transition-colors hover:text-sky-200">
        <span className="mr-1 inline-block text-[9px] text-slate-500 transition-transform group-open:rotate-90">
          ▶
        </span>
        {label}
      </summary>
      <div className="ml-1 mt-1.5 border-l border-sky-500/25 pl-2.5 text-xs text-slate-300">
        {children}
      </div>
    </details>
  );
}

// ------------------------------------------------------------------ Form bits

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-xs">
      <span className="label-tech mb-1 block">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-md border border-slate-600/70 bg-slate-950/70 px-2 py-1.5 text-sm text-slate-100 ' +
  'placeholder-slate-500 shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)] transition-colors ' +
  'focus:border-sky-500/70 focus:shadow-glow-cyan-soft focus:outline-none';

export const selectCls = inputCls;

// ------------------------------------------------------------------ Progress

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.min(100, Math.max(0, value * 100));
  return (
    <div
      className={cx(
        'relative h-1.5 w-full overflow-hidden rounded-full border border-slate-700/60 bg-slate-950/80',
        className,
      )}
    >
      <div
        className="relative h-full overflow-hidden rounded-full bg-gradient-to-r from-sky-500 to-violet-500 transition-[width] duration-300"
        style={{ width: `${pct}%` }}
      >
        {pct > 0 && pct < 100 && (
          <span className="absolute inset-y-0 w-8 animate-sheen bg-gradient-to-r from-transparent via-white/40 to-transparent" />
        )}
      </div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        'inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400',
        className,
      )}
    />
  );
}

// ------------------------------------------------------------------ Term with tooltip

export function Term({ text, tip }: { text: string; tip: string }) {
  return (
    <span
      title={tip}
      className="cursor-help underline decoration-sky-500/50 decoration-dotted underline-offset-2"
    >
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
          <tr key={i} className="border-b border-slate-700/40 last:border-0">
            <td className="py-1 pr-2 align-top text-slate-400">{r[0]}</td>
            <td className="value-mono py-1 text-right text-[11.5px]">{r[1]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ------------------------------------------------------------------ Empty state

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div
      className="rounded-lg border border-dashed border-slate-600/60 p-5 text-center"
      style={{
        background:
          'radial-gradient(240px 120px at 50% 0%, rgba(35,213,255,0.05), transparent 70%)',
      }}
    >
      <div className="text-sm font-medium text-slate-300">{title}</div>
      {children && <div className="mt-1 text-xs leading-relaxed text-slate-500">{children}</div>}
    </div>
  );
}
