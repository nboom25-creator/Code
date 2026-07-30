import { useState } from 'react'
import type { Alert, Decision, LoopRun, PerformanceResponse, User } from '../api/types'
import {
  Badge,
  Card,
  Empty,
  ErrorBox,
  EvidenceList,
  KeyValue,
  Loading,
  RegimeBadge,
  StatusBadge,
  Table,
} from '../components/primitives'
import { useApi, useMutation } from '../lib/hooks'
import { MISSING, bps, dateTime, duration, money, percent, ratio, relativeTime, titleCase } from '../lib/format'

interface JournalResponse {
  mode: string
  decisions: Decision[]
  action_counts: Record<string, number>
  approval_counts: Record<string, number>
}

interface AlertsResponse {
  unacknowledged_count: number
  alerts: Alert[]
}

export default function Journal({ user }: { user: User }) {
  const journal = useApi<JournalResponse>('/journal?limit=80', 20000)
  const alerts = useApi<AlertsResponse>('/alerts?limit=40', 20000)
  const loops = useApi<LoopRun[]>('/loops?limit=10', 30000)
  const performance = useApi<PerformanceResponse>('/performance', 60000)
  const [openDecision, setOpenDecision] = useState<number | null>(null)

  const canAct = user.role === 'admin' || user.role === 'operator'

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Decision mix">
          {!journal.data ? (
            <Loading />
          ) : (
            <dl>
              {Object.entries(journal.data.action_counts).map(([action, count]) => (
                <KeyValue key={action} label={action} value={count} />
              ))}
              {Object.entries(journal.data.approval_counts).map(([state, count]) => (
                <KeyValue key={state} label={titleCase(state)} value={count} />
              ))}
            </dl>
          )}
        </Card>

        <Card
          title="Confidence calibration"
          className="lg:col-span-2"
          hint={performance.data?.calibration?.note}
        >
          {!performance.data?.calibration?.buckets ? (
            <Empty
              message={performance.data?.calibration?.note ?? 'No completed trades with recorded confidence yet'}
              hint="Calibration compares what the system said it believed against what actually happened."
            />
          ) : (
            <>
              <Table
                head={
                  <tr>
                    <th>Confidence bucket</th>
                    <th className="text-right">Trades</th>
                    <th className="text-right">Stated confidence</th>
                    <th className="text-right">Realised win rate</th>
                    <th className="text-right">Gap</th>
                  </tr>
                }
              >
                {Object.entries(performance.data.calibration.buckets).map(([bucket, stats]) => {
                  const s = stats as Record<string, number>
                  return (
                    <tr key={bucket}>
                      <td>{bucket}</td>
                      <td className="num text-right">{s.count}</td>
                      <td className="num text-right">{percent(s.mean_confidence, 0)}</td>
                      <td className="num text-right">{percent(s.win_rate, 0)}</td>
                      <td
                        className={`num text-right ${
                          Math.abs(s.calibration_gap) > 0.15 ? 'text-warn' : 'text-ink-300'
                        }`}
                      >
                        {percent(s.calibration_gap, 0)}
                      </td>
                    </tr>
                  )
                })}
              </Table>
              <p className="mt-2 text-xs text-ink-400">
                Mean absolute gap:{' '}
                <span className="num">
                  {percent(performance.data.calibration.mean_absolute_calibration_gap, 0)}
                </span>
                . Confidence scales position size, so a persistent gap is a sizing problem, not a
                reporting curiosity.
              </p>
            </>
          )}
        </Card>
      </div>

      <Card
        title="Decision journal"
        hint="Append-only. Losing decisions and their reasoning are never rewritten."
        actions={
          <button type="button" className="btn-default" onClick={journal.reload}>
            Refresh
          </button>
        }
      >
        {journal.loading && !journal.data ? (
          <Loading />
        ) : journal.error ? (
          <ErrorBox error={journal.error} onRetry={journal.reload} />
        ) : !journal.data?.decisions.length ? (
          <Empty
            message="No decisions recorded yet"
            hint="Every proposed action — including the ones the risk engine blocks — appears here."
          />
        ) : (
          <ul className="space-y-2">
            {journal.data.decisions.map((decision) => (
              <li key={decision.id} className="rounded border border-ink-800">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <Badge
                    tone={
                      ['BUY', 'ADD'].includes(decision.action)
                        ? 'good'
                        : ['SELL', 'EXIT', 'TRIM'].includes(decision.action)
                          ? 'bad'
                          : 'neutral'
                    }
                  >
                    {decision.action}
                  </Badge>
                  <span className="font-medium">{decision.symbol}</span>
                  <StatusBadge status={decision.approval_state} />
                  <RegimeBadge regime={decision.regime} />
                  <span className="text-xs text-ink-400">{titleCase(decision.strategy_key)}</span>
                  <span className="num text-xs text-ink-400">
                    conf {percent(decision.confidence, 0)}
                  </span>
                  <span className="text-xs text-ink-500">{relativeTime(decision.decided_at)}</span>
                  <button
                    type="button"
                    className="btn-default ml-auto text-xs"
                    onClick={() => setOpenDecision(openDecision === decision.id ? null : decision.id)}
                    aria-expanded={openDecision === decision.id}
                  >
                    {openDecision === decision.id ? 'Hide' : 'Full record'}
                  </button>
                </div>
                <p className="border-t border-ink-850 px-3 py-2 text-sm text-ink-200">
                  {decision.explanation ?? 'No explanation was recorded.'}
                </p>
                {decision.rejection_reason && (
                  <p className="border-t border-ink-850 px-3 py-2 text-xs text-loss">
                    Blocked: {decision.rejection_reason}
                  </p>
                )}
                {openDecision === decision.id && (
                  <DecisionDetail
                    decisionId={decision.id}
                    canAct={canAct}
                    onChanged={() => journal.reload()}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title={`Alerts${alerts.data?.unacknowledged_count ? ` (${alerts.data.unacknowledged_count} unacknowledged)` : ''}`}
        >
          {!alerts.data?.alerts.length ? (
            <Empty message="No alerts" />
          ) : (
            <ul className="space-y-2">
              {alerts.data.alerts.slice(0, 20).map((alert) => (
                <li key={alert.id} className="rounded border border-ink-800 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge
                      tone={
                        alert.severity === 'critical' ? 'bad' : alert.severity === 'warning' ? 'warn' : 'info'
                      }
                    >
                      {alert.severity}
                    </Badge>
                    <span className="font-medium text-ink-100">{alert.title}</span>
                    <span className="text-ink-500">{relativeTime(alert.at)}</span>
                    {!alert.acknowledged && canAct && <AckButton alertId={alert.id} onDone={alerts.reload} />}
                    {alert.acknowledged && (
                      <span className="ml-auto text-ink-600">acked by {alert.acknowledged_by}</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-ink-300">{alert.message}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Post-trade reviews" hint={performance.data?.disclaimer}>
          {!performance.data?.post_trade_reviews.length ? (
            <Empty
              message="No post-trade reviews yet"
              hint="A review is written when a position closes, comparing expectation against outcome."
            />
          ) : (
            <Table
              head={
                <tr>
                  <th>Symbol</th>
                  <th>Outcome</th>
                  <th className="text-right">Return</th>
                  <th className="text-right">P&L</th>
                  <th className="text-right">Days</th>
                  <th className="text-right">Slippage</th>
                </tr>
              }
            >
              {performance.data.post_trade_reviews.slice(0, 25).map((review) => (
                <tr key={review.decision_id}>
                  <td className="font-medium">{review.symbol}</td>
                  <td className="text-xs">{titleCase(review.thesis_outcome)}</td>
                  <td className="num text-right">{percent(review.realized_return_pct, 1)}</td>
                  <td className="num text-right">{money(review.realized_pnl)}</td>
                  <td className="num text-right">{review.holding_days ?? MISSING}</td>
                  <td className="num text-right">{bps(review.slippage_bps)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <Card title="Cycle log" hint="Each autonomous cycle, step by step">
        {!loops.data?.length ? (
          <Empty message="No cycles recorded" />
        ) : (
          <ul className="space-y-3">
            {loops.data.map((run) => (
              <li key={run.id} className="rounded border border-ink-800 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <StatusBadge status={run.status} />
                  <RegimeBadge regime={run.regime} />
                  <span className="text-ink-400">{dateTime(run.started_at)}</span>
                  <span className="text-ink-500">{run.trigger}</span>
                  <span className="ml-auto num text-ink-500">{duration(run.duration_ms)}</span>
                </div>
                <p className="mt-1 text-sm text-ink-200">
                  {run.summary ?? run.halted_reason ?? run.error ?? '—'}
                </p>
                <ol className="mt-2 space-y-0.5">
                  {run.steps.map((step) => (
                    <li key={step.name} className="flex gap-2 text-xs">
                      <span className={step.ok ? 'text-gain' : 'text-loss'} aria-hidden>
                        {step.ok ? '✓' : '✗'}
                      </span>
                      <span className="w-56 shrink-0 text-ink-400">{step.name.replace(/^\d+_/, '')}</span>
                      <span className="text-ink-300">{step.message}</span>
                      <span className="ml-auto num text-ink-600">{step.duration_ms}ms</span>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function AckButton({ alertId, onDone }: { alertId: number; onDone: () => void }) {
  const { mutate, pending } = useMutation<undefined, unknown>(`/alerts/${alertId}/acknowledge`)
  return (
    <button
      type="button"
      className="btn-default ml-auto text-xs"
      disabled={pending}
      onClick={async () => {
        await mutate()
        onDone()
      }}
    >
      Acknowledge
    </button>
  )
}

function DecisionDetail({
  decisionId,
  canAct,
  onChanged,
}: {
  decisionId: number
  canAct: boolean
  onChanged: () => void
}) {
  const { data, loading } = useApi<Decision>(`/journal/${decisionId}`, 0)
  const approve = useMutation<{ approve: boolean; note: string }, unknown>(
    `/journal/${decisionId}/approval`,
  )

  if (loading) return <div className="px-3 pb-3"><Loading /></div>
  if (!data) return null

  const checks = data.risk_checks ?? []
  const rejects = checks.filter((c) => c.result === 'reject')
  const resizes = checks.filter((c) => c.result === 'resize')
  const warns = checks.filter((c) => c.result === 'warn')
  const signalInputs = Object.entries(data.signal_inputs ?? {})

  return (
    <div className="grid gap-4 border-t border-ink-850 bg-ink-950/60 p-3 md:grid-cols-3">
      <div className="space-y-3">
        <div>
          <h4 className="card-title">Recorded inputs</h4>
          {signalInputs.length ? (
            <dl className="mt-1">
              {signalInputs.map(([key, value]) => (
                <KeyValue
                  key={key}
                  label={titleCase(key)}
                  value={value === null ? MISSING : ratio(value, 4)}
                />
              ))}
            </dl>
          ) : (
            <p className="mt-1 text-xs text-ink-500">No signal inputs recorded.</p>
          )}
        </div>
        <div>
          <h4 className="card-title">Model and version</h4>
          <dl className="mt-1">
            <KeyValue label="Strategy" value={titleCase(data.strategy_key)} />
            <KeyValue label="Feature registry" value={data.model_version ?? MISSING} />
            <KeyValue label="Confidence" value={percent(data.confidence, 0)} />
            <KeyValue label="Uncertainty" value={percent(data.uncertainty, 0)} />
            <KeyValue label="Expected return" value={percent(data.expected_return, 1)} />
            <KeyValue label="Holding period" value={`${data.expected_holding_days ?? MISSING} sessions`} />
            <KeyValue label="Risk contribution" value={ratio(data.risk_contribution)} />
            <KeyValue label="Estimated cost" value={bps(data.estimated_cost_bps)} />
          </dl>
        </div>
      </div>

      <div className="space-y-3">
        <EvidenceList
          title="Bull case"
          items={data.bull_case ? data.bull_case.split('; ') : []}
          tone="good"
        />
        <EvidenceList
          title="Bear case"
          items={data.bear_case ? data.bear_case.split('; ') : []}
          tone="bad"
        />
        {data.exit_criteria && Object.keys(data.exit_criteria).length > 0 && (
          <div>
            <h4 className="card-title">Exit criteria</h4>
            <ul className="mt-1 space-y-0.5 text-xs text-ink-300">
              {Object.entries(data.exit_criteria).map(([key, value]) => (
                <li key={key}>
                  {titleCase(key)}: <span className="num">{String(value)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {data.sizing_detail && (
          <div>
            <h4 className="card-title">Sizing derivation</h4>
            <p className="mt-1 text-xs text-ink-300">{data.sizing_detail.explanation}</p>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <h4 className="card-title">
            Risk checks ({checks.length}) — {rejects.length} reject, {resizes.length} resize, {warns.length} warn
          </h4>
          {rejects.length + resizes.length + warns.length === 0 ? (
            <p className="mt-1 text-xs text-gain">Every limit passed with headroom.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-xs">
              {[...rejects, ...resizes, ...warns].map((check, index) => (
                <li key={`${check.check}-${index}`} className="flex gap-2">
                  <Badge
                    tone={check.result === 'reject' ? 'bad' : check.result === 'resize' ? 'warn' : 'neutral'}
                  >
                    {check.result}
                  </Badge>
                  <span className="text-ink-300">{check.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {data.review && (
          <div>
            <h4 className="card-title">Post-trade review</h4>
            <dl className="mt-1">
              <KeyValue label="Outcome" value={titleCase(data.review.thesis_outcome)} />
              <KeyValue label="Realised return" value={percent(data.review.realized_return_pct, 1)} />
              <KeyValue label="Realised P&L" value={money(data.review.realized_pnl)} />
              <KeyValue label="Slippage" value={bps(data.review.slippage_bps)} />
            </dl>
            {data.review.lessons && <p className="mt-1 text-xs text-ink-300">{data.review.lessons}</p>}
          </div>
        )}

        {data.approval_state === 'pending_human' && canAct && (
          <div className="rounded border border-warn/40 bg-warn/10 p-2">
            <p className="text-xs text-warn">This decision is awaiting human approval.</p>
            <p className="mt-1 text-[11px] text-ink-400">
              Approving does not bypass the risk engine — the order is re-evaluated at submission time.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="btn-primary text-xs"
                disabled={approve.pending}
                onClick={async () => {
                  await approve.mutate({ approve: true, note: 'approved from the journal' })
                  onChanged()
                }}
              >
                Approve
              </button>
              <button
                type="button"
                className="btn-default text-xs"
                disabled={approve.pending}
                onClick={async () => {
                  await approve.mutate({ approve: false, note: 'rejected from the journal' })
                  onChanged()
                }}
              >
                Reject
              </button>
            </div>
            {approve.error && <p className="mt-1 text-xs text-loss">{approve.error}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
