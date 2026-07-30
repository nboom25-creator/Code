import type { ReactNode } from 'react'
import { MISSING, pnlColor } from '../lib/format'

export function Card({
  title,
  children,
  actions,
  className = '',
  hint,
}: {
  title?: string
  children: ReactNode
  actions?: ReactNode
  className?: string
  hint?: string
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}

export function Stat({
  label,
  value,
  sub,
  tone,
  title,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'neutral' | 'signed' | 'good' | 'bad'
  title?: string
}) {
  const toneClass =
    tone === 'good' ? 'text-gain' : tone === 'bad' ? 'text-loss' : 'text-ink-100'
  return (
    <div title={title}>
      <div className="card-title">{label}</div>
      <div className={`stat mt-1 ${toneClass}`}>{value}</div>
      {sub !== undefined && <div className="mt-1 text-xs text-ink-400">{sub}</div>}
    </div>
  )
}

export function SignedStat({
  label,
  value,
  raw,
  sub,
}: {
  label: string
  value: ReactNode
  raw: string | number | null | undefined
  sub?: ReactNode
}) {
  return (
    <div>
      <div className="card-title">{label}</div>
      <div className={`stat mt-1 ${pnlColor(raw)}`}>{value}</div>
      {sub !== undefined && <div className="mt-1 text-xs text-ink-400">{sub}</div>}
    </div>
  )
}

const BADGE_TONES: Record<string, string> = {
  neutral: 'bg-ink-800 text-ink-200 border border-ink-700',
  good: 'bg-gain/15 text-gain border border-gain/40',
  bad: 'bg-loss/15 text-loss border border-loss/40',
  warn: 'bg-warn/15 text-warn border border-warn/40',
  info: 'bg-info/15 text-blue-200 border border-info/40',
  danger: 'bg-danger/25 text-red-200 border border-danger/60',
}

export function Badge({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode
  tone?: keyof typeof BADGE_TONES
  title?: string
}) {
  return (
    <span className={`badge ${BADGE_TONES[tone] ?? BADGE_TONES.neutral}`} title={title}>
      {children}
    </span>
  )
}

export function RegimeBadge({ regime }: { regime: string | null | undefined }) {
  if (!regime) return <Badge tone="warn">unclassified</Badge>
  const tone = regime === 'risk_on' ? 'good' : regime === 'risk_off' ? 'bad' : 'warn'
  return <Badge tone={tone}>{regime.replace('_', '-')}</Badge>
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    ['filled', 'completed', 'clean', 'ok', 'live', 'auto_approved', 'approved'].includes(status)
      ? 'good'
      : ['rejected', 'failed', 'canceled', 'cancelled', 'expired', 'rejected_by_risk', 'rejected_by_human', 'breaks_found'].includes(status)
        ? 'bad'
        : ['partially_filled', 'pending_human', 'paused', 'queued', 'running', 'new', 'pending_new'].includes(status)
          ? 'warn'
          : 'neutral'
  return <Badge tone={tone}>{status.replace(/_/g, ' ')}</Badge>
}

export function Empty({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="rounded border border-dashed border-ink-700 px-4 py-8 text-center">
      <p className="text-sm text-ink-300">{message}</p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  )
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-2 py-6 text-sm text-ink-400" role="status" aria-live="polite">
      <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-info" aria-hidden />
      {label}…
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="rounded border border-loss/40 bg-loss/10 px-4 py-3" role="alert">
      <p className="text-sm text-red-200">{error}</p>
      {onRetry && (
        <button type="button" className="btn-default mt-2" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}

/**
 * Banner shown whenever the data on screen is simulated.
 *
 * Deliberately unmissable and never dismissible: presenting simulated numbers
 * as real market results is the single most misleading thing this UI could do.
 */
export function SyntheticDataBanner({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`flex items-start gap-3 rounded border border-warn/50 bg-warn/10 ${
        compact ? 'px-3 py-2' : 'px-4 py-3'
      }`}
      role="note"
    >
      <span aria-hidden className="mt-0.5 text-warn">
        ▲
      </span>
      <div>
        <p className="text-sm font-semibold text-warn">Simulated market data</p>
        {!compact && (
          <p className="mt-1 text-xs text-ink-300">
            Every price, fundamental, headline and performance figure on this screen was produced by
            the built-in market simulator. It is not real market history and not real performance.
            Point <code className="text-ink-200">AEGIS_PRICE_PROVIDER</code> at{' '}
            <code className="text-ink-200">yfinance</code> or <code className="text-ink-200">alpaca</code>{' '}
            for real data.
          </p>
        )}
      </div>
    </div>
  )
}

/** Backtest results are hypothetical. This says so, next to the numbers. */
export function BacktestDisclaimer({ text }: { text?: string }) {
  return (
    <p className="rounded border border-ink-700 bg-ink-850 px-3 py-2 text-xs text-ink-300">
      {text ??
        'Backtested results are hypothetical and are not an indication of future returns. They are reported separately from paper and live results and are never combined with them.'}
    </p>
  )
}

export function KeyValue({ label, value, mono = true }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink-850 py-1.5 last:border-0">
      <dt className="text-xs text-ink-400">{label}</dt>
      <dd className={`text-sm text-ink-100 ${mono ? 'num' : ''}`}>{value ?? MISSING}</dd>
    </div>
  )
}

/** Horizontal utilisation meter with an explicit limit. */
export function Meter({
  value,
  label,
  detail,
  breached,
}: {
  value: number | null
  label: string
  detail?: string
  breached?: boolean
}) {
  const pct = value === null ? 0 : Math.max(0, Math.min(1, value)) * 100
  const tone = breached ? 'bg-loss' : pct > 85 ? 'bg-warn' : 'bg-info'
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-ink-300">{label}</span>
        <span className={`num ${breached ? 'text-loss' : 'text-ink-400'}`}>
          {value === null ? MISSING : `${pct.toFixed(0)}%`}
        </span>
      </div>
      <div
        className="mt-1 h-1.5 w-full overflow-hidden rounded bg-ink-800"
        role="meter"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} utilisation`}
      >
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      {detail && <p className="mt-1 text-[11px] text-ink-500">{detail}</p>}
    </div>
  )
}

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="scroll-x">
      <table className="table-base">
        <thead>{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function EvidenceList({
  title,
  items,
  tone = 'neutral',
}: {
  title: string
  items: string[]
  tone?: 'good' | 'bad' | 'warn' | 'neutral'
}) {
  if (!items?.length) return null
  const colour = tone === 'good' ? 'text-gain' : tone === 'bad' ? 'text-loss' : tone === 'warn' ? 'text-warn' : 'text-ink-300'
  return (
    <div>
      <h4 className={`text-xs font-semibold uppercase tracking-wide ${colour}`}>{title}</h4>
      <ul className="mt-1 space-y-1">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-xs text-ink-300">
            <span aria-hidden className={colour}>
              •
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
