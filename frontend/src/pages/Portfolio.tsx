import { useState } from 'react'
import type { PortfolioResponse, Position } from '../api/types'
import {
  Badge,
  Card,
  Empty,
  ErrorBox,
  KeyValue,
  Loading,
  Meter,
  SyntheticDataBanner,
  Table,
} from '../components/primitives'
import { useApi } from '../lib/hooks'
import { MISSING, money, percent, pnlColor, quantity, ratio, signedPercent, titleCase } from '../lib/format'

export default function Portfolio() {
  const { data, loading, error, reload } = useApi<PortfolioResponse>('/portfolio', 20000)
  const [expanded, setExpanded] = useState<string | null>(null)

  if (loading && !data) return <Loading label="Loading positions" />
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />
  if (!data) return null

  const sectorEntries = Object.entries(data.sector_exposure ?? {}).sort(
    (a, b) => Number(b[1]) - Number(a[1]),
  )
  const strategyEntries = Object.entries(data.strategy_exposure ?? {}).sort(
    (a, b) => Number(b[1]) - Number(a[1]),
  )

  return (
    <div className="space-y-6">
      {data.using_synthetic_data && <SyntheticDataBanner compact />}

      <div className="grid gap-4 lg:grid-cols-4">
        <Card title="Sector exposure" className="lg:col-span-2" hint="Share of equity by sector">
          {!sectorEntries.length ? (
            <Empty message="No open positions" />
          ) : (
            <div className="space-y-3">
              {sectorEntries.map(([sector, weight]) => (
                <Meter
                  key={sector}
                  label={sector}
                  value={Number(weight) / 0.35}
                  detail={`${percent(weight)} of equity (sector limit 35%)`}
                  breached={Number(weight) > 0.35}
                />
              ))}
            </div>
          )}
        </Card>

        <Card title="Strategy attribution" className="lg:col-span-2" hint="Share of equity by sleeve">
          {!strategyEntries.length ? (
            <Empty message="No attributed positions" />
          ) : (
            <div className="space-y-3">
              {strategyEntries.map(([key, weight]) => (
                <Meter
                  key={key}
                  label={titleCase(key)}
                  value={Number(weight) / 0.5}
                  detail={`${percent(weight)} of equity (strategy limit 50%)`}
                  breached={Number(weight) > 0.5}
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card
        title={`Positions (${data.positions.length})`}
        hint={`Total equity ${money(data.equity)}`}
      >
        {!data.positions.length ? (
          <Empty
            message="No open positions"
            hint="The autonomous loop opens positions only when a candidate clears portfolio construction and every risk limit."
          />
        ) : (
          <Table
            head={
              <tr>
                <th>Symbol</th>
                <th>Sector</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Avg entry</th>
                <th className="text-right">Last</th>
                <th className="text-right">Market value</th>
                <th className="text-right">Unrealised</th>
                <th className="text-right">Weight</th>
                <th className="text-right">Risk contrib.</th>
                <th>Strategy</th>
                <th>Thesis</th>
                <th />
              </tr>
            }
          >
            {data.positions.map((position) => (
              <PositionRow
                key={position.symbol}
                position={position}
                expanded={expanded === position.symbol}
                onToggle={() => setExpanded(expanded === position.symbol ? null : position.symbol)}
              />
            ))}
          </Table>
        )}
      </Card>
    </div>
  )
}

function PositionRow({
  position,
  expanded,
  onToggle,
}: {
  position: Position
  expanded: boolean
  onToggle: () => void
}) {
  const exits = Object.entries(position.exit_criteria ?? {})
  return (
    <>
      <tr>
        <td>
          <div className="font-medium">{position.symbol}</div>
          <div className="text-xs text-ink-500">{position.name}</div>
        </td>
        <td className="text-xs text-ink-300">{position.sector}</td>
        <td className="num text-right">{quantity(position.quantity)}</td>
        <td className="num text-right">{money(position.avg_entry_price)}</td>
        <td className="num text-right">{money(position.last_price)}</td>
        <td className="num text-right">{money(position.market_value)}</td>
        <td className={`num text-right ${pnlColor(position.unrealized_pnl)}`}>
          {money(position.unrealized_pnl)}
          <div className="text-xs">{signedPercent(position.unrealized_pnl_pct)}</div>
        </td>
        <td className="num text-right">
          {percent(position.weight)}
          <div className="text-xs text-ink-500">cap {percent(position.weight_limit, 0)}</div>
        </td>
        <td className="num text-right">{ratio(position.risk_contribution)}</td>
        <td className="text-xs">
          {position.strategy_key ? titleCase(position.strategy_key) : MISSING}
          <div className="mt-0.5">
            <Badge tone={position.thesis_status === 'intact' ? 'good' : 'warn'}>
              {position.thesis_status}
            </Badge>
          </div>
        </td>
        <td className="max-w-xs text-xs text-ink-300">
          {position.entry_thesis ? (
            <span className="line-clamp-2">{position.entry_thesis}</span>
          ) : (
            <span className="text-ink-600">not recorded</span>
          )}
        </td>
        <td>
          <button
            type="button"
            className="btn-default text-xs"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Hide' : 'Show'} details for ${position.symbol}`}
          >
            {expanded ? 'Hide' : 'Details'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={12} className="bg-ink-950/60">
            <div className="grid gap-4 p-2 md:grid-cols-3">
              <div>
                <h4 className="card-title">Entry thesis</h4>
                <p className="mt-1 text-sm text-ink-200">
                  {position.entry_thesis ?? 'No thesis was recorded for this position.'}
                </p>
              </div>
              <div>
                <h4 className="card-title">Exit conditions</h4>
                {exits.length ? (
                  <ul className="mt-1 space-y-1 text-xs text-ink-300">
                    {exits.map(([key, value]) => (
                      <li key={key}>
                        <span className="text-ink-400">{titleCase(key)}:</span>{' '}
                        <span className="num">{String(value)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-ink-500">No explicit exit criteria recorded.</p>
                )}
              </div>
              <div>
                <h4 className="card-title">Position detail</h4>
                <dl className="mt-1">
                  <KeyValue label="Cost basis" value={money(position.cost_basis)} />
                  <KeyValue label="Realised P&L" value={money(position.realized_pnl)} />
                  <KeyValue label="Stop price" value={money(position.stop_price)} />
                  <KeyValue label="Trailing stop" value={percent(position.trailing_stop_pct, 0)} />
                  <KeyValue label="Holding days" value={position.holding_days ?? MISSING} />
                  <KeyValue label="Price as of" value={position.last_price_at ?? MISSING} />
                </dl>
                <p className="mt-2 text-[11px] text-ink-600">
                  A stop price is a trigger level, not a guaranteed execution price: a gap through the
                  stop fills at the next available price.
                </p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
