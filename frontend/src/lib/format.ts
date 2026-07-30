/**
 * Display formatting.
 *
 * Values arrive from the API as decimal strings. These helpers convert at the
 * last possible moment and return an explicit em dash for missing data — never
 * `0`, because a zero reads as a real measurement and "unknown" is different
 * information from "zero".
 */

export const MISSING = '—'

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export function money(value: string | number | null | undefined, currency = 'USD'): string {
  const n = toNumber(value)
  if (n === null) return MISSING
  return n.toLocaleString(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function compactMoney(value: string | number | null | undefined): string {
  const n = toNumber(value)
  if (n === null) return MISSING
  const abs = Math.abs(n)
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return money(n)
}

export function percent(value: string | number | null | undefined, digits = 2): string {
  const n = toNumber(value)
  if (n === null) return MISSING
  return `${(n * 100).toFixed(digits)}%`
}

export function signedPercent(value: string | number | null | undefined, digits = 2): string {
  const n = toNumber(value)
  if (n === null) return MISSING
  const sign = n > 0 ? '+' : ''
  return `${sign}${(n * 100).toFixed(digits)}%`
}

export function num(value: string | number | null | undefined, digits = 2): string {
  const n = toNumber(value)
  if (n === null) return MISSING
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function integer(value: string | number | null | undefined): string {
  const n = toNumber(value)
  if (n === null) return MISSING
  return Math.round(n).toLocaleString()
}

export function quantity(value: string | number | null | undefined): string {
  const n = toNumber(value)
  if (n === null) return MISSING
  // Fractional shares are real; show up to four places but drop trailing zeros.
  return Number(n.toFixed(4)).toLocaleString(undefined, { maximumFractionDigits: 4 })
}

export function bps(value: string | number | null | undefined): string {
  const n = toNumber(value)
  if (n === null) return MISSING
  return `${n.toFixed(1)} bps`
}

export function ratio(value: string | number | null | undefined, digits = 2): string {
  const n = toNumber(value)
  if (n === null) return MISSING
  return n.toFixed(digits)
}

export function dateTime(value: string | null | undefined, timeZone?: string): string {
  if (!value) return MISSING
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return MISSING
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  })
}

export function dateOnly(value: string | null | undefined): string {
  if (!value) return MISSING
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return MISSING
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return MISSING
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return MISSING
  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 0) return 'in the future'
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return MISSING
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

/** Tailwind text colour for a signed value. */
export function pnlColor(value: string | number | null | undefined): string {
  const n = toNumber(value)
  if (n === null) return 'text-ink-400'
  if (n > 0) return 'text-gain'
  if (n < 0) return 'text-loss'
  return 'text-ink-300'
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return MISSING
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export { toNumber }
