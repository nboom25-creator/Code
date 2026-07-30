import type { RiskCentre as RiskData } from '../api/types'
import {
  Badge,
  Card,
  Empty,
  ErrorBox,
  KeyValue,
  Loading,
  Meter,
  Table,
} from '../components/primitives'
import { useApi } from '../lib/hooks'
import { MISSING, dateTime, num, percent, ratio, titleCase } from '../lib/format'

interface Probabilities {
  available: boolean
  observations?: number
  note?: string
  prob_drawdown_10?: number | null
  prob_drawdown_20?: number | null
  prob_drawdown_30?: number | null
  prob_drawdown_50?: number | null
  risk_of_ruin?: number | null
  expected_drawdown_duration_days?: number | null
  method?: string
}

const STAGE_LABELS: Record<string, string> = {
  warning: 'Drawdown warning — new position sizing reduced',
  defensive_1: 'Defensive stage one — gross exposure reduced, sizes halved',
  defensive_2: 'Defensive stage two — weak positions closed, no new entries',
  emergency: 'Emergency — orders cancelled, entries disabled, review required',
}

export default function RiskCentre() {
  const { data, loading, error, reload } = useApi<RiskData>('/risk', 20000)
  const probs = useApi<Probabilities>('/risk/probabilities', 120000)

  if (loading && !data) return <Loading label="Loading risk state" />
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />
  if (!data) return null

  const currentDrawdown = Number(data.defensive_stages.current_drawdown ?? 0)

  return (
    <div className="space-y-6">
      <Card
        title="Risk posture"
        actions={
          <Badge tone={data.risk_state === 'normal' ? 'good' : data.risk_state === 'warning' ? 'warn' : 'bad'}>
            {data.risk_state.replace('_', ' ')}
          </Badge>
        }
        hint={data.risk_state_reason ?? undefined}
      >
        <div className="grid gap-4 md:grid-cols-4">
          {(['warning', 'defensive_1', 'defensive_2', 'emergency'] as const).map((stage) => {
            const threshold = Number(data.defensive_stages[stage] ?? 0)
            const reached = Math.abs(currentDrawdown) >= threshold && threshold > 0
            return (
              <div
                key={stage}
                className={`rounded border px-3 py-2 ${
                  reached ? 'border-loss/60 bg-loss/10' : 'border-ink-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="card-title">{titleCase(stage)}</span>
                  <span className="num text-xs">{percent(threshold, 0)}</span>
                </div>
                <p className="mt-1 text-[11px] text-ink-400">{STAGE_LABELS[stage]}</p>
                {reached && <p className="mt-1 text-[11px] font-semibold text-loss">Threshold reached</p>}
              </div>
            )
          })}
        </div>
        <p className="mt-3 text-xs text-ink-400">
          Current drawdown: <span className="num">{percent(currentDrawdown, 2)}</span>. Stages escalate
          immediately and de-escalate only after recovering well clear of the warning line, so the
          posture does not flicker.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Limit utilisation" hint="Observed against configured limits">
          <div className="space-y-3">
            {Object.entries(data.utilisation).map(([name, u]) => (
              <Meter
                key={name}
                label={titleCase(name)}
                value={u.utilization === null ? null : Number(u.utilization)}
                detail={`${u.observed} of ${u.limit}`}
                breached={u.breached}
              />
            ))}
          </div>
        </Card>

        <Card title="Sector concentration">
          {!Object.keys(data.sector_utilisation).length ? (
            <Empty message="No sector exposure" />
          ) : (
            <div className="space-y-3">
              {Object.entries(data.sector_utilisation).map(([sector, u]) => (
                <Meter
                  key={sector}
                  label={sector}
                  value={u.utilization === null ? null : Number(u.utilization)}
                  detail={`${percent(u.observed)} of a ${percent(u.limit, 0)} limit`}
                  breached={u.breached}
                />
              ))}
            </div>
          )}
        </Card>

        <Card title="Strategy exposure">
          {!Object.keys(data.strategy_utilisation).length ? (
            <Empty message="No strategy exposure" />
          ) : (
            <div className="space-y-3">
              {Object.entries(data.strategy_utilisation).map(([key, u]) => (
                <Meter
                  key={key}
                  label={titleCase(key)}
                  value={u.utilization === null ? null : Number(u.utilization)}
                  detail={`${percent(u.observed)} of a ${percent(u.limit, 0)} limit`}
                  breached={u.breached}
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Correlations among holdings"
          hint={
            data.correlations.note ??
            `Threshold ${data.correlations.threshold ?? '—'} · ${data.correlations.above_threshold ?? 0} pair(s) above it`
          }
        >
          {!data.correlations.pairs.length ? (
            <Empty message="Not enough positions to compute correlations" />
          ) : (
            <>
              <p className="mb-2 text-xs text-ink-400">
                Average absolute correlation: <span className="num">{ratio(data.correlations.average)}</span>.
                High correlation means the portfolio is less diversified than the position count suggests.
              </p>
              <Table
                head={
                  <tr>
                    <th>Pair</th>
                    <th className="text-right">60-session correlation</th>
                  </tr>
                }
              >
                {data.correlations.pairs.slice(0, 15).map((pair) => (
                  <tr key={`${pair.a}-${pair.b}`}>
                    <td>
                      {pair.a} / {pair.b}
                    </td>
                    <td
                      className={`num text-right ${
                        Math.abs(pair.correlation) > Number(data.correlations.threshold ?? 0.7)
                          ? 'text-warn'
                          : ''
                      }`}
                    >
                      {ratio(pair.correlation)}
                    </td>
                  </tr>
                ))}
              </Table>
            </>
          )}
        </Card>

        <Card title="Stress tests" hint={data.stress_test.method ?? data.stress_test.note}>
          {data.stress_test.note ? (
            <Empty message={String(data.stress_test.note)} />
          ) : (
            <>
              <Table
                head={
                  <tr>
                    <th>Scenario</th>
                    <th className="text-right">Benchmark shock</th>
                    <th className="text-right">Estimated impact</th>
                    <th>Survives</th>
                  </tr>
                }
              >
                {Object.entries(data.stress_test.scenarios ?? {}).map(([name, spec]) => {
                  const s = spec as {
                    benchmark_shock: number
                    estimated_portfolio_impact: number
                    survives: boolean
                  }
                  return (
                    <tr key={name}>
                      <td>{titleCase(name)}</td>
                      <td className="num text-right text-ink-400">{percent(s.benchmark_shock, 0)}</td>
                      <td className="num text-right text-loss">
                        {percent(s.estimated_portfolio_impact, 1)}
                      </td>
                      <td>{s.survives ? <Badge tone="good">yes</Badge> : <Badge tone="bad">no</Badge>}</td>
                    </tr>
                  )
                })}
              </Table>
              {data.stress_test.worst_realised_windows && (
                <dl className="mt-3">
                  {Object.entries(data.stress_test.worst_realised_windows).map(([window, value]) => (
                    <KeyValue
                      key={window}
                      label={`Worst realised ${window.replace('worst_', '')}`}
                      value={percent(value as number, 2)}
                    />
                  ))}
                </dl>
              )}
            </>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Drawdown and ruin probabilities" hint={probs.data?.method}>
          {!probs.data?.available ? (
            <Empty message={probs.data?.note ?? 'Not enough portfolio history yet'} />
          ) : (
            <dl>
              <KeyValue label="P(10% drawdown, 1 year)" value={percent(probs.data.prob_drawdown_10, 0)} />
              <KeyValue label="P(20% drawdown, 1 year)" value={percent(probs.data.prob_drawdown_20, 0)} />
              <KeyValue label="P(30% drawdown, 1 year)" value={percent(probs.data.prob_drawdown_30, 0)} />
              <KeyValue label="P(50% drawdown, 1 year)" value={percent(probs.data.prob_drawdown_50, 0)} />
              <KeyValue label="Risk of ruin" value={percent(probs.data.risk_of_ruin, 2)} />
              <KeyValue
                label="Expected drawdown duration"
                value={`${num(probs.data.expected_drawdown_duration_days, 0)} sessions`}
              />
              <KeyValue label="Observations" value={probs.data.observations ?? MISSING} />
            </dl>
          )}
        </Card>

        <Card title="Configured limits" className="lg:col-span-2">
          <div className="grid gap-x-6 md:grid-cols-2">
            {Object.entries(data.limits).map(([name, value]) => (
              <KeyValue key={name} label={titleCase(name)} value={value} />
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Rejections by check (30 days)">
          {!Object.keys(data.rejection_counts_30d).length ? (
            <Empty message="No orders have been rejected in the last 30 days" />
          ) : (
            <dl>
              {Object.entries(data.rejection_counts_30d).map(([check, count]) => (
                <KeyValue key={check} label={titleCase(check)} value={count} />
              ))}
            </dl>
          )}
        </Card>

        <Card title="Recent risk events" className="lg:col-span-2" hint="Warnings, resizes and rejections">
          {!data.recent_risk_events.length ? (
            <Empty message="No risk events in the last seven days" />
          ) : (
            <Table
              head={
                <tr>
                  <th>Time</th>
                  <th>Check</th>
                  <th>Result</th>
                  <th className="text-right">Observed</th>
                  <th className="text-right">Limit</th>
                  <th>Message</th>
                </tr>
              }
            >
              {data.recent_risk_events.slice(0, 30).map((event, index) => (
                <tr key={`${event.at}-${event.check}-${index}`}>
                  <td className="text-xs">{dateTime(event.at)}</td>
                  <td className="text-xs">{titleCase(event.check)}</td>
                  <td>
                    <Badge
                      tone={event.result === 'reject' ? 'bad' : event.result === 'resize' ? 'warn' : 'neutral'}
                    >
                      {event.result}
                    </Badge>
                  </td>
                  <td className="num text-right text-xs">{event.observed ?? MISSING}</td>
                  <td className="num text-right text-xs">{event.limit ?? MISSING}</td>
                  <td className="max-w-md text-xs text-ink-300">{event.message}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </div>
  )
}
