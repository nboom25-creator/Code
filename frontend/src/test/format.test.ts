import { describe, expect, it } from 'vitest'
import {
  MISSING,
  bps,
  compactMoney,
  money,
  num,
  percent,
  pnlColor,
  quantity,
  ratio,
  signedPercent,
  titleCase,
} from '../lib/format'

describe('formatting', () => {
  it('renders missing values as an em dash rather than zero', () => {
    // This matters: showing 0 for unknown data would read as a real measurement.
    expect(money(null)).toBe(MISSING)
    expect(money(undefined)).toBe(MISSING)
    expect(money('')).toBe(MISSING)
    expect(percent(null)).toBe(MISSING)
    expect(num(null)).toBe(MISSING)
    expect(bps(null)).toBe(MISSING)
    expect(ratio(null)).toBe(MISSING)
    expect(quantity(null)).toBe(MISSING)
  })

  it('does not confuse zero with missing', () => {
    expect(money(0)).not.toBe(MISSING)
    expect(percent(0)).toBe('0.00%')
  })

  it('formats decimal strings from the API without precision loss in display', () => {
    expect(money('1234.5678')).toContain('1,234.57')
    expect(percent('0.0725', 2)).toBe('7.25%')
    expect(signedPercent('0.0725')).toBe('+7.25%')
    expect(signedPercent('-0.0725')).toBe('-7.25%')
  })

  it('rejects non-numeric input instead of rendering NaN', () => {
    expect(money('not-a-number')).toBe(MISSING)
    expect(percent('abc')).toBe(MISSING)
  })

  it('compacts large money values', () => {
    expect(compactMoney('4500000000000')).toBe('$4.50T')
    expect(compactMoney('2500000000')).toBe('$2.50B')
    expect(compactMoney('1500000')).toBe('$1.5M')
    expect(compactMoney('2500')).toBe('$2.5K')
  })

  it('preserves fractional share quantities', () => {
    expect(quantity('18.3139290000')).toBe('18.3139')
    expect(quantity('100')).toBe('100')
  })

  it('colours signed values, and stays neutral when unknown', () => {
    expect(pnlColor('12.5')).toBe('text-gain')
    expect(pnlColor('-12.5')).toBe('text-loss')
    expect(pnlColor('0')).toBe('text-ink-300')
    expect(pnlColor(null)).toBe('text-ink-400')
  })

  it('humanises snake_case keys', () => {
    expect(titleCase('max_sector_exposure_pct')).toBe('Max Sector Exposure Pct')
    expect(titleCase(null)).toBe(MISSING)
  })
})
