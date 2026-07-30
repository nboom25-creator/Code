import { useState } from 'react'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Candidate, OpportunitiesResponse } from '../api/types'
import {
  Card,
  Empty,
  ErrorBox,
  EvidenceList,
  KeyValue,
  Loading,
  RegimeBadge,
  SyntheticDataBanner,
  Table,
} from '../components/primitives'
import { useApi } from '../lib/hooks'
import { MISSING, bps, num, percent, relativeTime, titleCase } from '../lib/format'

export default function Opportunities() {
  const [live, setLive] = useState(false)
  const { data, loading, error, reload, lastUpdated } = useApi<OpportunitiesResponse>(
    `/opportunities?limit=40${live ? '&live=true' : ''}`,
    live ? 0 : 60000,
  )
  const [selected, setSelected] = useState<string | null>(null)

  if (loading && !data) return <Loading label="Ranking opportunities" />
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />
  if (!data) return null

  const chosen = data.candidates.find((c) => c.symbol === selected) ?? data.candidates[0] ?? null

  return (
    <div className="space-y-6">
      {data.using_synthetic_data && <SyntheticDataBanner compact />}

      <Card
        title="Opportunity Centre"
        hint={
          data.as_of
            ? `Ranked ${data.candidates.length} candidate(s) from ${data.universe_evaluated ?? '—'} evaluated names · ${
                data.source === 'live' ? 'recomputed now' : 'from the last cycle'
              } · ${relativeTime(data.as_of)}`
            : 'No ranking computed yet'
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-default"
              onClick={() => {
                setLive(true)
                reload()
              }}
            >
              Recompute now
            </button>
            <button type="button" className="btn-default" onClick={reload}>
              Refresh
            </button>
          </div>
        }
      >
        {!data.candidates.length ? (
          <Empty
            message={data.note ?? 'No candidate passes the current filters'}
            hint="An empty list is a normal outcome. The base rate of 'no good trade today' is high, and the regime gate blocks new entries entirely in risk-off conditions."
          />
        ) : (
          <div className="grid gap-4 xl:grid-cols-5">
            <div className="xl:col-span-3">
              <Table
                head={
                  <tr>
                    <th>#</th>
                    <th>Symbol</th>
                    <th className="text-right">Growth score</th>
                    <th className="text-right">Confidence</th>
                    <th className="text-right">Expected return</th>
                    <th className="text-right">Downside</th>
                    <th className="text-right">Cost</th>
                    <th>Strategies</th>
                    <th />
                  </tr>
                }
              >
                {data.candidates.map((candidate, index) => (
                  <tr
                    key={candidate.symbol}
                    className={chosen?.symbol === candidate.symbol ? 'bg-ink-850' : undefined}
                  >
                    <td className="num text-ink-500">{candidate.rank ?? index + 1}</td>
                    <td className="font-medium">
                      {candidate.symbol}
                      {candidate.sector && (
                        <div className="text-xs text-ink-500">{candidate.sector}</div>
                      )}
                    </td>
                    <td className="num text-right">{num(candidate.growth_score, 0)}</td>
                    <td className="num text-right">{percent(candidate.confidence, 0)}</td>
                    <td className="num text-right">
                      {percent(candidate.expected_return, 1)}
                      <div className="text-xs text-ink-500">
                        {percent(candidate.expected_return_low, 0)} …{' '}
                        {percent(candidate.expected_return_high, 0)}
                      </div>
                    </td>
                    <td className="num text-right text-loss">{percent(candidate.downside_estimate, 1)}</td>
                    <td className="num text-right text-ink-400">{bps(candidate.estimated_cost_bps)}</td>
                    <td className="text-xs">
                      {(candidate.strategies ?? [candidate.strategy_key ?? '']).filter(Boolean).map((key) => (
                        <div key={key}>{titleCase(key)}</div>
                      ))}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-default text-xs"
                        onClick={() => setSelected(candidate.symbol)}
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>
            </div>

            <div className="xl:col-span-2">
              {chosen ? <CandidateDetail candidate={chosen} /> : <Empty message="Select a candidate" />}
            </div>
          </div>
        )}
        {lastUpdated && (
          <p className="mt-3 text-xs text-ink-600">Last updated {lastUpdated.toLocaleTimeString()}</p>
        )}
      </Card>
    </div>
  )
}

function CandidateDetail({ candidate }: { candidate: Candidate }) {
  const components = Object.entries(candidate.components ?? {})
  const chartData = components
    .filter(([, comp]) => comp && typeof comp === 'object')
    .map(([key, comp]) => ({
      name: titleCase(key.replace('growth_', '')),
      score: comp.score ?? 0,
      available: comp.score !== null,
    }))

  return (
    <div className="space-y-4">
      <Card title={`${candidate.symbol} — proposed trade`} actions={<RegimeBadge regime={candidate.regime} />}>
        {candidate.disqualifiers?.length ? (
          <div className="mb-3 rounded border border-loss/40 bg-loss/10 px-3 py-2">
            <p className="text-xs font-semibold text-loss">Disqualified — not investable</p>
            <ul className="mt-1 space-y-0.5 text-xs text-red-200">
              {candidate.disqualifiers.map((d) => (
                <li key={d}>• {d}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-sm text-ink-200">{candidate.thesis ?? 'No thesis text recorded.'}</p>

        <dl className="mt-3">
          <KeyValue label="Confidence" value={percent(candidate.confidence, 0)} />
          <KeyValue label="Uncertainty" value={percent(candidate.uncertainty, 0)} />
          <KeyValue
            label="Expected return"
            value={`${percent(candidate.expected_return, 1)} (${percent(candidate.expected_return_low, 0)} … ${percent(candidate.expected_return_high, 0)})`}
          />
          <KeyValue label="Expected volatility" value={percent(candidate.expected_vol, 0)} />
          <KeyValue label="Downside estimate" value={percent(candidate.downside_estimate, 1)} />
          <KeyValue label="Holding period" value={`${candidate.expected_holding_days ?? MISSING} sessions`} />
          <KeyValue label="Estimated cost" value={bps(candidate.estimated_cost_bps)} />
          <KeyValue
            label="Input coverage"
            value={candidate.coverage === null || candidate.coverage === undefined ? MISSING : percent(candidate.coverage, 0)}
          />
        </dl>
        <p className="mt-2 text-[11px] text-ink-600">
          The expected-return range is a one-sigma band from the strategy's own volatility estimate. It
          is a model estimate, not a forecast, and not a promise.
        </p>
      </Card>

      {chartData.length > 0 && (
        <Card title="Growth score components" hint="Weaknesses are shown, not averaged away">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }}>
                <XAxis type="number" domain={[0, 100]} stroke="#6b7794" fontSize={11} />
                <YAxis type="category" dataKey="name" stroke="#6b7794" fontSize={10} width={110} />
                <Tooltip
                  contentStyle={{ background: '#131824', border: '1px solid #252d40', fontSize: 12 }}
                  formatter={(value: number) => `${value.toFixed(0)} / 100`}
                />
                <Bar dataKey="score" radius={[0, 3, 3, 0]}>
                  {chartData.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={!entry.available ? '#354057' : entry.score >= 70 ? '#12a67a' : entry.score >= 40 ? '#3d82d1' : '#d99a2b'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 space-y-1 text-xs">
            {components.map(([key, comp]) =>
              comp?.missing?.length ? (
                <li key={key} className="text-ink-500">
                  {titleCase(key.replace('growth_', ''))}: {comp.missing.length} input(s) unavailable
                </li>
              ) : null,
            )}
          </ul>
        </Card>
      )}

      <Card title="Evidence">
        <div className="space-y-4">
          <EvidenceList title="Supporting" items={candidate.supporting_evidence} tone="good" />
          <EvidenceList title="Opposing" items={candidate.opposing_evidence} tone="bad" />
          <EvidenceList title="Known weaknesses" items={candidate.weaknesses} tone="warn" />
        </div>
      </Card>
    </div>
  )
}
