'use client'

import { useTranslations } from 'next-intl'
import { Badge, Card } from '@/components'
import { formatParamValue, getParamSpec } from '@/lib/governance/params'
import type { ExecutedChange } from '@/lib/governance/timelock'
import type { CSSProperties } from 'react'

/**
 * ExecutedHistory — what actually changed (#90).
 *
 * The queue answers "what is about to happen"; this answers "what already
 * happened", with the before and after value of every parameter an action
 * touched. Cancellations sit in the same log so an investor can see that a
 * change they feared never landed.
 */
export interface ExecutedHistoryProps {
  entries: ExecutedChange[]
  /** Cap the rows; the rest are summarised in a footer line. */
  limit?: number
}

export function ExecutedHistory({ entries, limit = 8 }: ExecutedHistoryProps) {
  const t = useTranslations('Governance')
  const shown = entries.slice(0, limit)
  const hidden = entries.length - shown.length

  return (
    <section aria-labelledby="governance-history-title">
      <h2 id="governance-history-title" style={sectionTitle}>
        {t('historyTitle')}
      </h2>
      <p style={{ ...subtext, marginTop: 4, marginBottom: 16 }}>{t('historyCaption')}</p>

      {entries.length === 0 ? (
        <Card style={{ padding: 24 }}>
          <p style={{ ...subtext, margin: 0 }}>{t('historyEmpty')}</p>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {shown.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} />
          ))}
          {hidden > 0 && (
            <p style={{ ...subtext, margin: 0 }}>{t('historyMore', { count: hidden })}</p>
          )}
        </div>
      )}
    </section>
  )
}

function HistoryRow({ entry }: { entry: ExecutedChange }) {
  const t = useTranslations('Governance')
  const cancelled = entry.kind === 'cancelled'

  return (
    <Card style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={rowHeader}>
        <div style={{ minWidth: 220, flex: '1 1 300px' }}>
          <div style={proposalId}>
            {entry.proposalId} · {formatStamp(entry.resolvedAt)}
          </div>
          <h3 style={entryTitle}>{entry.proposalTitle}</h3>
          <div style={rowMeta}>
            <span>{t(cancelled ? 'cancelledBy' : 'executedBy', { actor: entry.actor })}</span>
            {entry.txHash && (
              <>
                <span aria-hidden="true">·</span>
                <span>{entry.txHash} ↗</span>
              </>
            )}
          </div>
        </div>
        <Badge tone={cancelled ? 'neutral' : 'growth'}>
          {cancelled ? t('historyCancelled') : t('historyExecuted')}
        </Badge>
      </div>

      <table style={table}>
        <thead>
          <tr>
            <th scope="col" style={{ ...th, textAlign: 'left' }}>
              {t('colParameter')}
            </th>
            <th scope="col" style={th}>
              {t('historyBefore')}
            </th>
            <th scope="col" style={th}>
              {t('historyAfter')}
            </th>
          </tr>
        </thead>
        <tbody>
          {entry.changes.map((change) => {
            const spec = getParamSpec(change.key)
            const unit = spec.unitKey ? t(`unit_${spec.unitKey}`) : ''
            return (
              <tr key={change.key}>
                <th scope="row" style={{ ...td, textAlign: 'left', fontFamily: 'var(--font-body)' }}>
                  {t(spec.labelKey)}
                </th>
                <td style={td}>
                  {formatParamValue(change.key, change.current)}
                  {unit && <span style={unitText}>{unit}</span>}
                </td>
                <td style={td}>
                  <span style={{ fontWeight: 600 }}>
                    {cancelled ? '—' : formatParamValue(change.key, change.next)}
                  </span>
                  {!cancelled && unit && <span style={unitText}>{unit}</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Card>
  )
}

function formatStamp(epochMs: number): string {
  return `${new Date(epochMs).toISOString().slice(0, 10)} ${new Date(epochMs)
    .toISOString()
    .slice(11, 16)} UTC`
}

const sectionTitle: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 700,
  fontSize: 'var(--type-h5)',
  margin: '32px 0 0',
  color: 'var(--ink)',
}

const subtext: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--type-caption)',
  lineHeight: 1.5,
  color: 'var(--ink-60)',
}

const rowHeader: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
  flexWrap: 'wrap',
}

const proposalId: CSSProperties = {
  fontFamily: 'var(--font-data)',
  fontSize: 'var(--type-eyebrow)',
  color: 'var(--ink-60)',
  marginBottom: 4,
}

const entryTitle: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 700,
  fontSize: 'var(--type-body)',
  margin: 0,
  color: 'var(--ink)',
}

const rowMeta: CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 6,
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--type-eyebrow)',
  color: 'var(--ink-40)',
  flexWrap: 'wrap',
}

const table: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
}

const th: CSSProperties = {
  padding: '6px 10px',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--type-eyebrow)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-eyebrow)',
  color: 'var(--ink-60)',
  borderBottom: '1px solid var(--ink-12)',
  whiteSpace: 'nowrap',
}

const td: CSSProperties = {
  padding: '10px',
  fontFamily: 'var(--font-data)',
  fontFeatureSettings: '"tnum" 1',
  color: 'var(--ink-60)',
  borderBottom: '1px solid var(--ink-12)',
  textAlign: 'right',
}

const unitText: CSSProperties = {
  marginLeft: 4,
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--type-eyebrow)',
  color: 'var(--ink-40)',
}
