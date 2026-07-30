import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { LoopRun, Overview as OverviewData, PortfolioResponse } from '../api/types'
import {
  Badge,
  Card,
  Empty,
  ErrorBox,
  KeyValue,
  Loading,
  RegimeBadge,
  SignedStat,
  Stat,
  SyntheticDataBanner,
} from '../components/primitives'
import { useApi } from '../lib/hooks'
import { compactMoney, dateTime, duration, money, percent, relativeTime, signedPercent } from '../lib/format'

export default function Overview() {
  const { data, loading, error, reload } = useApi<OverviewData>('/overview', 15000)
  const { data: portfolio } = useApi<PortfolioResponse>('/portfolio', 60000)
  const { data: loops } = useApi<LoopRun[]>('/loops?limit=6', 30000)

  if (loading && !data) return <Loading label="Loading account overview" />
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />
  if (!data) return null

  const curve = (portfolio?.equity_curve ?? []).map((point) => ({
    date: point.session_date,
    equity: Number(point.equity),
    drawdown: point.drawdown === null ? 0 : Number(point.drawdown) * 100,
  }))

  return (
    <div className="space-y-6">
      {data.config.using_synthetic_data && <SyntheticDataBanner />}

      {data.controls.kill_switch_engaged && (
        <div className="rounded border border-danger bg-danger/20 px-4 py-3" role="alert">
          <p className="font-semibold text-red-100">Kill switch engaged — all order flow is blocked</p>
          <p className="mt-1 text-sm text-red-200">{data.controls.kill_switch_reason}</p>
        </div>
      )}
      {data.controls.trading_halted_for_date && (
        <div className="rounded border border-loss/50 bg-loss/10 px-4 py-3" role="alert">
          <p className="font-semibold text-red-200">
            Trading halted for {data.controls.trading_halted_for_date}
          </p>
          <p className="mt-1 text-sm text-ink-300">{data.controls.halt_reason}</p>
          {data.controls.recovery_requires_approval && (
            <p className="mt-1 text-xs text-warn">
              Resuming requires an administrator to approve recovery from the Execution screen.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Card>
          <Stat label="Equity" value={money(data.account.equity)} sub={`source: ${data.account.source}`} />
        </Card>
        <Card>
          <Stat label="Cash" value={money(data.account.cash)} sub={`buying power ${money(data.account.buying_power)}`} />
        </Card>
        <Card>
          <SignedStat
            label="Day P&L"
            value={money(data.pnl.day)}
            raw={data.pnl.day}
            sub={signedPercent(data.pnl.day_pct)}
          />
        </Card>
        <Card>
          <SignedStat
            label="Cumulative P&L"
            value={money(data.pnl.cumulative)}
            raw={data.pnl.cumulative}
            sub={`high-water mark ${compactMoney(data.pnl.high_water_mark)}`}
          />
        </Card>
        <Card>
          <Stat
            label="Drawdown"
            value={percent(data.pnl.drawdown_pct)}
            tone={Number(data.pnl.drawdown_pct ?? 0) < -0.05 ? 'bad' : 'neutral'}
            sub={`risk state: ${data.controls.risk_state.replace('_', ' ')}`}
          />
        </Card>
        <Card>
          <Stat
            label="Gross exposure"
            value={percent(data.exposure.gross)}
            sub={`${data.exposure.open_positions} positions · limit ${percent(data.exposure.max_gross, 0)}`}
          />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          title="Equity curve"
          className="lg:col-span-2"
          hint={
            data.config.using_synthetic_data
              ? 'Simulated paper account — not real performance'
              : `Paper account, ${curve.length} observation(s)`
          }
        >
          {curve.length < 2 ? (
            <Empty
              message="Not enough history to chart yet"
              hint="The equity curve appears once the autonomous loop has recorded at least two portfolio snapshots."
            />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={curve} margin={{ top: 6, right: 8, bottom: 0, left: 8 }}>
                  <defs>
                    <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3d82d1" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#3d82d1" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#1a2030" vertical={false} />
                  <XAxis dataKey="date" stroke="#6b7794" fontSize={11} tickMargin={6} />
                  <YAxis
                    stroke="#6b7794"
                    fontSize={11}
                    tickFormatter={(v) => compactMoney(v)}
                    width={70}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    contentStyle={{ background: '#131824', border: '1px solid #252d40', fontSize: 12 }}
                    formatter={(value: number) => money(value)}
                  />
                  <Area
                    type="monotone"
                    dataKey="equity"
                    stroke="#3d82d1"
                    strokeWidth={2}
                    fill="url(#equityFill)"
                    name="Equity"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card title="Market regime" actions={<RegimeBadge regime={data.regime.regime} />}>
          {data.regime.explanation ? (
            <>
              <p className="text-sm text-ink-200">{data.regime.explanation}</p>
              <dl className="mt-3">
                <KeyValue label="Composite score" value={data.regime.score ?? '—'} />
                <KeyValue label="Assessed" value={relativeTime(data.regime.as_of)} />
              </dl>
            </>
          ) : (
            <Empty message="No regime assessment yet" hint="Run one autonomous cycle to classify the regime." />
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="System health">
          <dl>
            <KeyValue
              label="Market data"
              value={
                data.health.providers.all_ok ? (
                  <Badge tone="good">operational</Badge>
                ) : (
                  <Badge tone="bad">degraded</Badge>
                )
              }
            />
            <KeyValue
              label="Broker"
              value={
                data.health.broker.ok ? (
                  <Badge tone="good">{data.health.broker.broker ?? 'connected'}</Badge>
                ) : (
                  <Badge tone="bad">{data.health.broker.error?.slice(0, 40) ?? 'unavailable'}</Badge>
                )
              }
            />
            <KeyValue
              label="Data quality"
              value={
                data.health.data_quality.blocking > 0 ? (
                  <Badge tone="bad">{data.health.data_quality.blocking} blocking</Badge>
                ) : data.health.data_quality.open_total > 0 ? (
                  <Badge tone="warn">{data.health.data_quality.open_total} open</Badge>
                ) : (
                  <Badge tone="good">clean</Badge>
                )
              }
            />
            <KeyValue
              label="Reconciliation"
              value={
                data.health.reconciliation.status === 'clean' ? (
                  <Badge tone="good">clean</Badge>
                ) : data.health.reconciliation.status ? (
                  <Badge tone="bad">{data.health.reconciliation.breaks} break(s)</Badge>
                ) : (
                  '—'
                )
              }
            />
            <KeyValue label="Last cycle" value={relativeTime(data.health.last_loop_at)} />
            <KeyValue label="Server time" value={dateTime(data.server_time_utc)} />
          </dl>
        </Card>

        <Card title="Recent cycles" className="lg:col-span-2">
          {!loops?.length ? (
            <Empty message="No autonomous cycles recorded yet" hint="Trigger one from Settings, or start the scheduler." />
          ) : (
            <ul className="space-y-2">
              {loops.map((run) => (
                <li key={run.id} className="rounded border border-ink-800 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={run.status === 'completed' ? 'good' : run.status === 'failed' ? 'bad' : 'warn'}>
                      {run.status}
                    </Badge>
                    <RegimeBadge regime={run.regime} />
                    <span className="text-ink-400">{relativeTime(run.started_at)}</span>
                    <span className="text-ink-500">{run.trigger}</span>
                    <span className="ml-auto num text-ink-500">{duration(run.duration_ms)}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink-200">
                    {run.summary ?? run.halted_reason ?? run.error ?? 'no summary recorded'}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-ink-500">
                    <span>{run.candidates_considered} candidates</span>
                    <span>{run.decisions_made} decisions</span>
                    <span>{run.orders_submitted} submitted</span>
                    <span>{run.orders_rejected} blocked by risk</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
