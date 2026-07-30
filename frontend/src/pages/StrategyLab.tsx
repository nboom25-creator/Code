import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { BacktestDetail, BacktestSummary, StrategyMeta, User } from '../api/types'
import {
  BacktestDisclaimer,
  Badge,
  Card,
  Empty,
  ErrorBox,
  KeyValue,
  Loading,
  StatusBadge,
  Table,
} from '../components/primitives'
import { useApi, useMutation } from '../lib/hooks'
import { MISSING, compactMoney, dateOnly, duration, money, num, percent, ratio, titleCase } from '../lib/format'

export default function StrategyLab({ user }: { user: User }) {
  const strategies = useApi<StrategyMeta[]>('/strategies', 60000)
  const runs = useApi<BacktestSummary[]>('/backtests?limit=40', 15000)
  const [selectedRun, setSelectedRun] = useState<number | null>(null)
  const [openStrategy, setOpenStrategy] = useState<string | null>(null)

  const canRun = user.role === 'admin' || user.role === 'operator'

  return (
    <div className="space-y-6">
      <NewBacktest
        strategies={strategies.data ?? []}
        canRun={canRun}
        onQueued={() => runs.reload()}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title="Backtest runs"
          hint="In-sample, validation and out-of-sample results are labelled and never mixed"
          actions={
            <button type="button" className="btn-default" onClick={runs.reload}>
              Refresh
            </button>
          }
        >
          {runs.loading && !runs.data ? (
            <Loading />
          ) : runs.error ? (
            <ErrorBox error={runs.error} onRetry={runs.reload} />
          ) : !runs.data?.length ? (
            <Empty message="No backtests yet" hint="Queue one above, or run `aegisquant seed` to create a demo pair." />
          ) : (
            <Table
              head={
                <tr>
                  <th>Label</th>
                  <th>Phase</th>
                  <th>Status</th>
                  <th className="text-right">Return</th>
                  <th className="text-right">CAGR</th>
                  <th className="text-right">Sharpe</th>
                  <th className="text-right">Max DD</th>
                  <th className="text-right">Trades</th>
                  <th>Accepted</th>
                  <th />
                </tr>
              }
            >
              {runs.data.map((run) => (
                <tr key={run.id} className={selectedRun === run.id ? 'bg-ink-850' : undefined}>
                  <td>
                    <div className="font-medium">{run.label}</div>
                    <div className="text-xs text-ink-500">
                      {dateOnly(run.start_date)} → {dateOnly(run.end_date)}
                    </div>
                  </td>
                  <td>
                    <Badge tone={run.phase === 'out_of_sample' ? 'info' : 'neutral'}>
                      {run.phase.replace(/_/g, ' ')}
                    </Badge>
                  </td>
                  <td>
                    <StatusBadge status={run.status} />
                    {run.uses_synthetic_data && (
                      <div className="mt-0.5">
                        <Badge tone="warn">simulated</Badge>
                      </div>
                    )}
                  </td>
                  <td className="num text-right">{percent(run.headline.total_return, 1)}</td>
                  <td className="num text-right">{percent(run.headline.cagr, 1)}</td>
                  <td className="num text-right">{ratio(run.headline.sharpe)}</td>
                  <td className="num text-right text-loss">{percent(run.headline.max_drawdown, 1)}</td>
                  <td className="num text-right">{run.headline.trades ?? MISSING}</td>
                  <td>
                    {run.accepted === null ? (
                      <span className="text-xs text-ink-500">—</span>
                    ) : run.accepted ? (
                      <Badge tone="good">accepted</Badge>
                    ) : (
                      <Badge tone="bad">rejected</Badge>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-default text-xs"
                      onClick={() => setSelectedRun(run.id)}
                    >
                      Inspect
                    </button>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card
          title="Strategies"
          hint="Each sleeve declares its own data needs, entry and exit rules, sizing method and invalidating conditions"
        >
          {!strategies.data?.length ? (
            <Loading />
          ) : (
            <ul className="space-y-2">
              {strategies.data.map((strategy) => (
                <li key={strategy.key} className="rounded border border-ink-800">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left"
                    onClick={() => setOpenStrategy(openStrategy === strategy.key ? null : strategy.key)}
                    aria-expanded={openStrategy === strategy.key}
                  >
                    <span className="font-medium">{strategy.name}</span>
                    <StatusBadge status={strategy.status} />
                    {!strategy.enabled && <Badge tone="bad">disabled</Badge>}
                    <span className="ml-auto num text-xs text-ink-400">
                      weight {percent(strategy.target_weight, 1)}
                    </span>
                  </button>
                  {openStrategy === strategy.key && (
                    <div className="space-y-3 border-t border-ink-800 px-3 py-3 text-xs">
                      <p className="text-ink-300">{strategy.description}</p>
                      <Detail label="Sizing" items={[titleCase(strategy.sizing_method)]} />
                      <Detail label="Holding period" items={[`${strategy.expected_holding_days} sessions`]} />
                      <Detail label="Supported regimes" items={strategy.supported_regimes.map(titleCase)} />
                      <Detail label="Universe rules" items={strategy.universe_rules} />
                      <Detail label="Entry criteria" items={strategy.entry_criteria} />
                      <Detail label="Exit criteria" items={strategy.exit_criteria} />
                      <Detail label="Risk assumptions" items={strategy.risk_assumptions} />
                      <Detail label="Invalidating conditions" items={strategy.invalidating_conditions} />
                      <Detail label="Capacity" items={[strategy.capacity_notes]} />
                      {strategy.paused_reason && (
                        <p className="rounded border border-warn/40 bg-warn/10 px-2 py-1 text-warn">
                          Paused: {strategy.paused_reason}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {selectedRun !== null && <RunDetail runId={selectedRun} onClose={() => setSelectedRun(null)} />}
    </div>
  )
}

function Detail({ label, items }: { label: string; items: string[] }) {
  if (!items?.length || !items[0]) return null
  return (
    <div>
      <h4 className="card-title">{label}</h4>
      <ul className="mt-1 space-y-0.5 text-ink-300">
        {items.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </div>
  )
}

function NewBacktest({
  strategies,
  canRun,
  onQueued,
}: {
  strategies: StrategyMeta[]
  canRun: boolean
  onQueued: () => void
}) {
  const today = new Date()
  const fourYearsAgo = new Date(today.getTime() - 4 * 365 * 86400000)
  const [start, setStart] = useState(fourYearsAgo.toISOString().slice(0, 10))
  const [end, setEnd] = useState(today.toISOString().slice(0, 10))
  const [label, setLabel] = useState('lab run')
  const [phase, setPhase] = useState('in_sample')
  const [keys, setKeys] = useState<string[]>([])
  const [withValidation, setWithValidation] = useState(false)
  const { mutate, pending, error, result } = useMutation<Record<string, unknown>, { run_id: number }>(
    '/backtests',
  )

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const queued = await mutate({
      start,
      end,
      label,
      phase,
      strategy_keys: keys,
      with_validation: withValidation,
      rebalance_interval_days: 5,
      review_interval_days: 5,
    })
    if (queued) onQueued()
  }

  return (
    <Card
      title="Run a backtest"
      hint="Signals are computed at each close and filled at the next open, with spread, impact, partial fills and commissions modelled"
    >
      {!canRun && (
        <p className="mb-3 rounded border border-ink-700 bg-ink-850 px-3 py-2 text-xs text-ink-400">
          Your role is read-only for this action. An operator or administrator can queue backtests.
        </p>
      )}
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-6">
        <label className="md:col-span-1">
          <span className="card-title">Start</span>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="mt-1 w-full rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="md:col-span-1">
          <span className="card-title">End</span>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="mt-1 w-full rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="md:col-span-1">
          <span className="card-title">Label</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1 w-full rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="md:col-span-1">
          <span className="card-title">Phase</span>
          <select
            value={phase}
            onChange={(e) => setPhase(e.target.value)}
            className="mt-1 w-full rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm"
          >
            <option value="in_sample">In-sample</option>
            <option value="validation">Validation</option>
            <option value="out_of_sample">Out-of-sample</option>
          </select>
        </label>
        <label className="md:col-span-2">
          <span className="card-title">Strategies (none = all)</span>
          <select
            multiple
            value={keys}
            onChange={(e) => setKeys(Array.from(e.target.selectedOptions, (o) => o.value))}
            className="mt-1 h-[38px] w-full rounded border border-ink-700 bg-ink-950 px-2 py-1 text-sm"
            size={1}
          >
            {strategies.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 md:col-span-3">
          <input
            type="checkbox"
            checked={withValidation}
            onChange={(e) => setWithValidation(e.target.checked)}
          />
          <span className="text-xs text-ink-300">
            Also run walk-forward and parameter sensitivity (much slower, required by the promotion gate)
          </span>
        </label>

        <div className="md:col-span-3 md:text-right">
          <button type="submit" className="btn-primary" disabled={pending || !canRun}>
            {pending ? 'Queueing…' : 'Queue backtest'}
          </button>
        </div>
      </form>

      {error && <p className="mt-2 text-xs text-loss">{error}</p>}
      {result && (
        <p className="mt-2 text-xs text-gain">
          Queued as run #{result.run_id}. It appears in the table below once it completes.
        </p>
      )}
    </Card>
  )
}

function RunDetail({ runId, onClose }: { runId: number; onClose: () => void }) {
  const { data, loading, error } = useApi<BacktestDetail>(`/backtests/${runId}`, 0)

  if (loading) return <Card title={`Run #${runId}`}><Loading /></Card>
  if (error) return <Card title={`Run #${runId}`}><ErrorBox error={error} /></Card>
  if (!data) return null

  const metrics = data.metrics ?? {}
  const trade = metrics.trade_stats ?? {}
  const curve = data.equity_curve.map((p) => ({
    date: p.date,
    strategy: Number(p.equity),
    benchmark: p.benchmark === null ? null : Number(p.benchmark),
    drawdown: Number(p.drawdown) * 100,
  }))
  const wf = data.diagnostics?.walk_forward
  const mc = data.diagnostics?.monte_carlo
  const stress = data.diagnostics?.stress
  const bootstrap = data.diagnostics?.bootstrap

  return (
    <Card
      title={`Run #${data.id} — ${data.label}`}
      actions={
        <button type="button" className="btn-default" onClick={onClose}>
          Close
        </button>
      }
      hint={`${data.phase.replace(/_/g, ' ')} · ${dateOnly(data.start_date)} → ${dateOnly(data.end_date)} · ${duration(data.duration_ms)}`}
    >
      <div className="space-y-4">
        <BacktestDisclaimer text={data.disclaimer} />

        {data.rejection_reasons?.rejections?.length ? (
          <div className="rounded border border-loss/40 bg-loss/10 px-3 py-2">
            <p className="text-xs font-semibold text-loss">Rejected by the acceptance screen</p>
            <ul className="mt-1 space-y-0.5 text-xs text-red-200">
              {data.rejection_reasons.rejections.map((r) => (
                <li key={r}>• {r}</li>
              ))}
            </ul>
          </div>
        ) : data.accepted ? (
          <div className="rounded border border-gain/40 bg-gain/10 px-3 py-2 text-xs text-gain">
            Passed the acceptance screen. This means the result cleared the configured governance
            checks — it is not evidence of future profitability.
          </div>
        ) : null}

        {data.rejection_reasons?.warnings?.length ? (
          <div className="rounded border border-warn/40 bg-warn/10 px-3 py-2">
            <p className="text-xs font-semibold text-warn">Warnings</p>
            <ul className="mt-1 space-y-0.5 text-xs text-ink-300">
              {data.rejection_reasons.warnings.map((w) => (
                <li key={w}>• {w}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {curve.length > 1 && (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curve} margin={{ top: 6, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid stroke="#1a2030" vertical={false} />
                <XAxis dataKey="date" stroke="#6b7794" fontSize={11} minTickGap={40} />
                <YAxis stroke="#6b7794" fontSize={11} tickFormatter={(v) => compactMoney(v)} width={70} />
                <Tooltip
                  contentStyle={{ background: '#131824', border: '1px solid #252d40', fontSize: 12 }}
                  formatter={(value: number) => money(value)}
                />
                <Line type="monotone" dataKey="strategy" stroke="#12a67a" dot={false} strokeWidth={2} name="Strategy" />
                <Line
                  type="monotone"
                  dataKey="benchmark"
                  stroke="#6b7794"
                  dot={false}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  name="Benchmark (buy & hold)"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <h4 className="card-title mb-2">Growth</h4>
            <dl>
              <KeyValue label="Total return" value={percent(metrics.total_return, 1)} />
              <KeyValue label="CAGR" value={percent(metrics.cagr, 1)} />
              <KeyValue label="Geometric mean (daily)" value={percent(metrics.geometric_mean_daily, 3)} />
              <KeyValue label="Benchmark return" value={percent(metrics.benchmark_total_return, 1)} />
              <KeyValue label="Excess (CAGR)" value={percent(metrics.excess_return, 1)} />
              <KeyValue label="Upside capture" value={ratio(metrics.upside_capture)} />
              <KeyValue label="Downside capture" value={ratio(metrics.downside_capture)} />
            </dl>
          </div>
          <div>
            <h4 className="card-title mb-2">Risk</h4>
            <dl>
              <KeyValue label="Volatility" value={percent(metrics.annualized_volatility, 1)} />
              <KeyValue label="Sharpe" value={ratio(metrics.sharpe)} />
              <KeyValue label="Sortino" value={ratio(metrics.sortino)} />
              <KeyValue label="Calmar" value={ratio(metrics.calmar)} />
              <KeyValue label="Max drawdown" value={percent(metrics.max_drawdown, 1)} />
              <KeyValue label="Drawdown duration" value={`${metrics.max_drawdown_duration_days ?? MISSING} days`} />
              <KeyValue label="Time to recovery" value={`${metrics.time_to_recovery_days ?? MISSING} days`} />
              <KeyValue label="VaR 95%" value={percent(metrics.var_95, 2)} />
              <KeyValue label="Expected shortfall 95%" value={percent(metrics.expected_shortfall_95, 2)} />
              <KeyValue label="Beta" value={ratio(metrics.beta)} />
              <KeyValue label="Alpha (annual)" value={percent(metrics.alpha_annual, 1)} />
            </dl>
          </div>
          <div>
            <h4 className="card-title mb-2">Trades</h4>
            <dl>
              <KeyValue label="Trades" value={trade.trades ?? MISSING} />
              <KeyValue label="Win rate" value={percent(trade.win_rate, 0)} />
              <KeyValue label="Profit factor" value={ratio(trade.profit_factor)} />
              <KeyValue label="Average win" value={money(trade.avg_win)} />
              <KeyValue label="Average loss" value={money(trade.avg_loss)} />
              <KeyValue label="Expectancy" value={money(trade.expectancy)} />
              <KeyValue label="Avg holding" value={`${num(trade.avg_holding_days, 0)} days`} />
              <KeyValue label="Top-5 winner share" value={percent(trade.top5_winner_share, 0)} />
              <KeyValue label="Total costs" value={money(trade.total_costs)} />
              <KeyValue label="Cost / gross P&L" value={percent(trade.cost_share_of_gross, 0)} />
            </dl>
          </div>
          <div>
            <h4 className="card-title mb-2">Survival</h4>
            <dl>
              <KeyValue label="P(10% drawdown)" value={percent(metrics.prob_drawdown_10, 0)} />
              <KeyValue label="P(20% drawdown)" value={percent(metrics.prob_drawdown_20, 0)} />
              <KeyValue label="P(30% drawdown)" value={percent(metrics.prob_drawdown_30, 0)} />
              <KeyValue label="P(50% drawdown)" value={percent(metrics.prob_drawdown_50, 0)} />
              <KeyValue label="Risk of ruin" value={percent(metrics.risk_of_ruin, 2)} />
              <KeyValue label="Exposure (avg)" value={percent(metrics.exposure_avg, 0)} />
              <KeyValue label="Turnover (annual)" value={ratio(metrics.turnover_annual)} />
              <KeyValue label="Capacity estimate" value={compactMoney(metrics.capacity_estimate_usd)} />
            </dl>
            <p className="mt-2 text-[11px] text-ink-600">
              Drawdown probabilities come from a block bootstrap of realised returns. They assume the
              return distribution continues to resemble the past.
            </p>
          </div>
        </div>

        {(wf || mc || stress || bootstrap) && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {wf && (
              <div>
                <h4 className="card-title mb-2">Walk-forward</h4>
                <dl>
                  <KeyValue label="Fold pass rate" value={percent(wf.pass_rate, 0)} />
                  <KeyValue label="Folds" value={wf.folds?.length ?? MISSING} />
                  <KeyValue label="Mean test Sharpe" value={ratio(wf.mean_test_sharpe)} />
                  <KeyValue label="Sharpe decay" value={ratio(wf.train_test_sharpe_decay)} />
                  <KeyValue label="Out-of-sample trades" value={wf.total_test_trades ?? MISSING} />
                </dl>
                {wf.notes?.map((n: string) => (
                  <p key={n} className="mt-1 text-[11px] text-warn">
                    {n}
                  </p>
                ))}
              </div>
            )}
            {mc && !mc.note && (
              <div>
                <h4 className="card-title mb-2">Monte Carlo (trade order)</h4>
                <dl>
                  <KeyValue label="Median final equity" value={compactMoney(mc.median_final_equity)} />
                  <KeyValue label="5th percentile" value={compactMoney(mc.p5_final_equity)} />
                  <KeyValue label="Median max drawdown" value={percent(mc.median_max_drawdown, 1)} />
                  <KeyValue label="5th pct max drawdown" value={percent(mc.p5_max_drawdown, 1)} />
                  <KeyValue label="P(loss)" value={percent(mc.probability_of_loss, 0)} />
                </dl>
              </div>
            )}
            {bootstrap && !bootstrap.note && (
              <div>
                <h4 className="card-title mb-2">Bootstrap intervals</h4>
                <dl>
                  <KeyValue
                    label="CAGR (5–95%)"
                    value={`${percent(bootstrap.cagr?.p5, 1)} … ${percent(bootstrap.cagr?.p95, 1)}`}
                  />
                  <KeyValue
                    label="Sharpe (5–95%)"
                    value={`${ratio(bootstrap.sharpe?.p5)} … ${ratio(bootstrap.sharpe?.p95)}`}
                  />
                  <KeyValue
                    label="Max DD (5–95%)"
                    value={`${percent(bootstrap.max_drawdown?.p5, 1)} … ${percent(bootstrap.max_drawdown?.p95, 1)}`}
                  />
                </dl>
              </div>
            )}
            {stress && !stress.note && (
              <div>
                <h4 className="card-title mb-2">Stress scenarios</h4>
                <dl>
                  {Object.entries(stress.scenarios ?? {}).map(([name, spec]) => {
                    const s = spec as { estimated_portfolio_impact: number; survives: boolean }
                    return (
                      <KeyValue
                        key={name}
                        label={titleCase(name)}
                        value={
                          <span className={s.survives ? 'text-ink-100' : 'text-loss'}>
                            {percent(s.estimated_portfolio_impact, 1)}
                          </span>
                        }
                      />
                    )
                  })}
                </dl>
              </div>
            )}
          </div>
        )}

        {data.regime_metrics && Object.keys(data.regime_metrics).length > 0 && (
          <div>
            <h4 className="card-title mb-2">Performance by regime</h4>
            <Table
              head={
                <tr>
                  <th>Regime</th>
                  <th className="text-right">Days</th>
                  <th className="text-right">Total return</th>
                  <th className="text-right">Annualised</th>
                  <th className="text-right">Volatility</th>
                  <th className="text-right">Sharpe</th>
                  <th className="text-right">Worst day</th>
                </tr>
              }
            >
              {Object.entries(data.regime_metrics).map(([regime, stats]) => {
                const s = stats as Record<string, number | null>
                return (
                  <tr key={regime}>
                    <td>{titleCase(regime)}</td>
                    <td className="num text-right">{num(s.days, 0)}</td>
                    <td className="num text-right">{percent(s.total_return, 1)}</td>
                    <td className="num text-right">{percent(s.annualized_return, 1)}</td>
                    <td className="num text-right">{percent(s.volatility, 1)}</td>
                    <td className="num text-right">{ratio(s.sharpe)}</td>
                    <td className="num text-right text-loss">{percent(s.worst_day, 2)}</td>
                  </tr>
                )
              })}
            </Table>
          </div>
        )}

        {data.diagnostics?.strategy_attribution && (
          <div>
            <h4 className="card-title mb-2">Strategy attribution</h4>
            <Table
              head={
                <tr>
                  <th>Strategy</th>
                  <th className="text-right">Trades</th>
                  <th className="text-right">Net P&L</th>
                  <th className="text-right">Win rate</th>
                  <th className="text-right">Avg holding</th>
                </tr>
              }
            >
              {Object.entries(data.diagnostics.strategy_attribution).map(([key, stats]) => {
                const s = stats as Record<string, number>
                return (
                  <tr key={key}>
                    <td>{titleCase(key)}</td>
                    <td className="num text-right">{s.trades}</td>
                    <td className="num text-right">{money(s.net_pnl)}</td>
                    <td className="num text-right">{percent(s.win_rate, 0)}</td>
                    <td className="num text-right">{num(s.avg_holding_days, 0)}</td>
                  </tr>
                )
              })}
            </Table>
          </div>
        )}

        {data.trades.length > 0 && (
          <div>
            <h4 className="card-title mb-2">Trades ({data.trades.length})</h4>
            <div className="max-h-80 overflow-y-auto">
              <Table
                head={
                  <tr>
                    <th>Symbol</th>
                    <th>Strategy</th>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th className="text-right">Return</th>
                    <th className="text-right">Net P&L</th>
                    <th className="text-right">Costs</th>
                    <th className="text-right">Days</th>
                    <th>Exit reason</th>
                  </tr>
                }
              >
                {data.trades.slice(0, 400).map((t, index) => (
                  <tr key={`${t.symbol}-${t.entry_at}-${index}`}>
                    <td>{t.symbol}</td>
                    <td className="text-xs text-ink-400">{titleCase(t.strategy_key)}</td>
                    <td className="text-xs">{dateOnly(t.entry_at)}</td>
                    <td className="text-xs">{dateOnly(t.exit_at)}</td>
                    <td className={`num text-right ${Number(t.return_pct) >= 0 ? 'text-gain' : 'text-loss'}`}>
                      {percent(t.return_pct, 1)}
                    </td>
                    <td className="num text-right">{money(t.net_pnl)}</td>
                    <td className="num text-right text-ink-400">{money(t.costs)}</td>
                    <td className="num text-right">{t.holding_days ?? MISSING}</td>
                    <td className="max-w-xs text-xs text-ink-400">{t.exit_reason ?? MISSING}</td>
                  </tr>
                ))}
              </Table>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
