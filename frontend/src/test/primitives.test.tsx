import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  BacktestDisclaimer,
  Badge,
  Meter,
  RegimeBadge,
  SyntheticDataBanner,
} from '../components/primitives'

describe('SyntheticDataBanner', () => {
  it('states plainly that the data is simulated', () => {
    render(<SyntheticDataBanner />)
    expect(screen.getByText(/Simulated market data/i)).toBeInTheDocument()
    expect(screen.getByText(/not real market history/i)).toBeInTheDocument()
  })

  it('has no dismiss control — it must not be hideable', () => {
    const { container } = render(<SyntheticDataBanner />)
    expect(container.querySelector('button')).toBeNull()
  })
})

describe('BacktestDisclaimer', () => {
  it('says backtested results are hypothetical', () => {
    render(<BacktestDisclaimer />)
    expect(screen.getByText(/hypothetical/i)).toBeInTheDocument()
    expect(screen.getByText(/not an indication of future returns/i)).toBeInTheDocument()
  })
})

describe('RegimeBadge', () => {
  it('shows an unclassified regime rather than assuming risk-on', () => {
    render(<RegimeBadge regime={null} />)
    expect(screen.getByText('unclassified')).toBeInTheDocument()
  })

  it('renders each known regime', () => {
    const { rerender } = render(<RegimeBadge regime="risk_on" />)
    expect(screen.getByText('risk-on')).toBeInTheDocument()
    rerender(<RegimeBadge regime="risk_off" />)
    expect(screen.getByText('risk-off')).toBeInTheDocument()
  })
})

describe('Meter', () => {
  it('exposes an accessible meter role with the utilisation value', () => {
    render(<Meter label="Gross exposure" value={0.62} detail="62% of limit" />)
    const meter = screen.getByRole('meter', { name: /gross exposure/i })
    expect(meter).toHaveAttribute('aria-valuenow', '62')
    expect(meter).toHaveAttribute('aria-valuemax', '100')
  })

  it('renders an em dash when utilisation is unknown', () => {
    render(<Meter label="Unknown" value={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('clamps a breached value to the bar width', () => {
    render(<Meter label="Breached" value={1.8} breached />)
    const meter = screen.getByRole('meter', { name: /breached/i })
    expect(meter).toHaveAttribute('aria-valuenow', '100')
  })
})

describe('Badge', () => {
  it('renders its children and an accessible title', () => {
    render(
      <Badge tone="danger" title="live money">
        LIVE
      </Badge>,
    )
    expect(screen.getByTitle('live money')).toHaveTextContent('LIVE')
  })
})
