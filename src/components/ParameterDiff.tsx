import type { ReactNode } from 'react'
import type { CSSProperties } from 'react'
import { useTranslations } from 'next-intl'
import { formatParamValue, getParamSpec, type ParamKey } from '@/lib/governance/params'
import { roundToDecimals } from '@/lib/format'
import type { ParameterChange } from '@/lib/governance/timelock'

/**
 * ParameterDiff — the shared "what will change" viewer (#90).
 *
 * One row per parameter: the value in force now, the value that takes effect,
 * and a signed change chip. Deliberately dumb — it takes the changes, the two
 * column labels, and an optional note renderer, so the timelock queue and the
 * proposal wizard show the identical diff instead of drifting apart.
 *
 * Direction is carried by a glyph and a sign, never by colour alone.
 */
export interface ParameterDiffProps {
  changes: ParameterChange[]
  /** Column header for the value in force now. */
  beforeLabel: string
  /** Column header for the value that takes effect. */
  afterLabel: string
  /** Rendered in a full-width row beneath each change — used for impact notes. */
  renderNote?: (change: ParameterChange) => ReactNode
  /** Shown when `changes` is empty. */
  emptyLabel: string
  /** Caption above the table, e.g. the proposal id. */
  caption?: string
}

export function ParameterDiff({
  changes,
  beforeLabel,
  afterLabel,
  renderNote,
  emptyLabel,
  caption,
}: ParameterDiffProps) {
  const t = useTranslations('Governance')

  if (changes.length === 0) {
    return (
      <p style={emptyText}>{emptyLabel}</p>
    )
  }

  return (
    <table style={table}>
      {caption && <caption style={captionStyle}>{caption}</caption>}
      <thead>
        <tr>
          <th scope="col" style={{ ...th, textAlign: 'left' }}>
            {t('colParameter')}
          </th>
          <th scope="col" style={th}>
            {beforeLabel}
          </th>
          <th scope="col" style={th}>
            {afterLabel}
          </th>
          <th scope="col" style={th}>
            {t('colChange')}
          </th>
        </tr>
      </thead>
      <tbody>
        {changes.map((change) => (
          <DiffRow
            key={change.key}
            change={change}
            renderNote={renderNote}
            unit={t(unitKeyFor(change))}
          />
        ))}
      </tbody>
    </table>
  )
}

function unitKeyFor(change: ParameterChange): string {
  const spec = getParamSpec(change.key)
  return `unit_${spec.unitKey ?? 'none'}`
}

interface DiffRowProps {
  change: ParameterChange
  renderNote?: (change: ParameterChange) => ReactNode
  unit: string
}

function DiffRow({ change, renderNote, unit }: DiffRowProps) {
  const t = useTranslations('Governance')
  const spec = getParamSpec(change.key)
  const rises = change.next > change.current
  const falls = change.next < change.current
  const pct = change.current === 0 ? null : ((change.next - change.current) / change.current) * 100
  const dirLabel = rises ? 'changeUp' : falls ? 'changeDown' : 'changeFlat'
  const arrow = rises ? '▲' : falls ? '▼' : '■'
  const tone = rises ? 'var(--ember)' : falls ? 'var(--growth)' : 'var(--ink-60)'

  return (
    <>
      <tr>
        <th scope="row" style={{ ...td, textAlign: 'left', fontWeight: 600 }}>
          <span style={paramLabel}>{t(spec.labelKey)}</span>
          <span style={paramHint}>{t(spec.hintKey)}</span>
        </th>
        <td style={td}>
          <span style={beforeValue}>{formatParamValue(change.key, change.current)}</span>
          <span style={unitText}>{unit}</span>
        </td>
        <td style={td}>
          <span style={afterValue}>{formatParamValue(change.key, change.next)}</span>
          <span style={unitText}>{unit}</span>
        </td>
        <td style={td}>
          <span style={{ ...changeChip, color: tone }}>
            <span aria-hidden="true">{arrow}</span> {t(dirLabel)}
            {pct !== null && ` ${formatDelta(pct)}`}
          </span>
        </td>
      </tr>
      {renderNote && (
        <tr>
          <td colSpan={4} style={{ ...td, paddingTop: 0 }}>
            {renderNote(change)}
          </td>
        </tr>
      )}
    </>
  )
}

/** Signed percentage, e.g. `+14.3%` / `−20%`. */
export function formatDelta(pct: number): string {
  const rounded = roundToDecimals(Math.abs(pct), pct !== 0 && Math.abs(pct) < 10 ? 1 : 0)
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : ''
  return `${sign}${rounded}%`
}

const table: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontFamily: 'var(--font-body)',
}

const captionStyle: CSSProperties = {
  captionSide: 'top',
  textAlign: 'left',
  paddingBottom: 10,
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--type-eyebrow)',
  color: 'var(--ink-60)',
}

const th: CSSProperties = {
  padding: '8px 10px',
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
  padding: '12px 10px',
  fontFamily: 'var(--font-data)',
  fontFeatureSettings: '"tnum" 1',
  color: 'var(--ink)',
  borderBottom: '1px solid var(--ink-12)',
  textAlign: 'right',
  verticalAlign: 'top',
}

const paramLabel: CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--type-small)',
  fontWeight: 600,
  color: 'var(--ink)',
}

const paramHint: CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--type-caption)',
  fontWeight: 400,
  color: 'var(--ink-60)',
  marginTop: 2,
}

const beforeValue: CSSProperties = {
  color: 'var(--ink-60)',
  textDecoration: 'line-through',
  textDecorationColor: 'var(--ink-40)',
}

const afterValue: CSSProperties = {
  color: 'var(--ink)',
  fontWeight: 600,
}

const unitText: CSSProperties = {
  marginLeft: 4,
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--type-eyebrow)',
  color: 'var(--ink-40)',
}

const changeChip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontFamily: 'var(--font-data)',
  fontSize: 'var(--type-caption)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
}

const emptyText: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--type-small)',
  color: 'var(--ink-60)',
}
