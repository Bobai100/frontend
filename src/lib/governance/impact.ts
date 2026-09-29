// Impact calculator for queued governance actions (#90).
//
// A timelock only buys users time to react if they can see what the change does
// to *their* money. This module turns a pending parameter change plus the
// investor's open positions into a plain-language verdict:
//   "Tightens the credit floor to 80 — 3 of your 6 open positions fall below it."
//
// Pure functions, no i18n and no React, so the numbers are unit-testable and
// reusable by the proposal wizard (which needs the same preview before an HBIP
// is ever queued).

import { getParamSpec, type ParamKey } from './params'
import type { ParameterChange } from './timelock'

/** One open position — the pool's exposure to a project the investor co-owns. */
export interface Position {
  id: number
  name: string
  /** Oracle-verified Credit Quality, 0–100. */
  credit: number
  /** Oracle-verified Green Impact, 0–100. */
  green: number
  /** Capital deployed to the project, in USDC. */
  fundedAmount: number
}

export type ImpactSeverity = 'none' | 'low' | 'high'

export interface Impact {
  param: ParamKey
  /** 'tightens' when the new value restricts more, 'loosens' when it relaxes. */
  direction: 'tightens' | 'loosens'
  /** True when the change only affects fees/fees-adjacent parameters. */
  /** Positions that do not satisfy the *new* value. */
  affectedCount: number
  /** Positions that satisfied the old value but no longer do. */
  newlyAffectedCount: number
  /** How many positions the investor is exposed to. */
  totalCount: number
  /** USDC deployed across the affected positions. */
  affectedAmount: number
  /** Total USDC deployed across all positions. */
  totalAmount: number
  severity: ImpactSeverity
  /** `Governance` i18n key for the note, e.g. `impactCreditNote`. */
  noteKey: string
  /** Params for the note: affected / total counts and the threshold pair. */
  noteValues: { affected: number; total: number; current: number; next: number }
  /** The affected positions, for the row's "show me" list. */
  affected: Position[]
}

const HIGH_AFFECTED_RATIO = 0.5
const LOW_AMOUNT_RATIO = 0.05

/**
 * Score a single queued change against a set of open positions.
 *
 * The rules per gate:
 * - `credit` / `green`: a *rising* floor is a tightening. Positions already
 *   below the new floor fall out (they may be wound down / no longer funded),
 *   so they are the affected set. Lowering the floor affects nobody, because
 *   every position that qualified still qualifies.
 * - `allocation`: a *falling* per-project cap is a tightening. Positions
 *   deployed above the new cap are over the limit.
 * - `fee`, `liquidity`, `oracle`: not position-selective — a fee change touches
 *   every open position, so all of them are "affected", and the note says so.
 */
export function calculateImpact(change: ParameterChange, positions: Position[]): Impact {
  const spec = getParamSpec(change.key)
  const { current, next } = change
  const totalCount = positions.length
  const totalAmount = sum(positions.map((p) => p.fundedAmount))
  const all = [...positions]

  let affected: Position[] = []
  let direction: Impact['direction'] = 'tightens'
  let noteKey = 'impactGenericNote'

  switch (spec.gate) {
    case 'credit':
      direction = next > current ? 'tightens' : 'loosens'
      affected = direction === 'tightens' ? all.filter((p) => p.credit < next) : []
      noteKey = 'impactCreditNote'
      break
    case 'green':
      direction = next > current ? 'tightens' : 'loosens'
      affected = direction === 'tightens' ? all.filter((p) => p.green < next) : []
      noteKey = 'impactGreenNote'
      break
    case 'allocation':
      direction = next < current ? 'tightens' : 'loosens'
      affected = direction === 'tightens' ? all.filter((p) => p.fundedAmount > next) : []
      noteKey = 'impactAllocationNote'
      break
    default:
      // Fee / grace-period / oracle-staleness changes are pool-wide: they do not
      // single out positions, so every open position is in scope.
      direction = 'tightens'
      affected = all
      noteKey = 'impactPoolWideNote'
      break
  }

  const wasQualifying = (p: Position) =>
    spec.gate === 'credit'
      ? p.credit >= current
      : spec.gate === 'green'
        ? p.green >= current
        : spec.gate === 'allocation'
          ? p.fundedAmount <= current
          : true

  const affectedAmount = sum(affected.map((p) => p.fundedAmount))
  const newlyAffected = affected.filter(wasQualifying).length

  return {
    param: change.key,
    direction,
    affectedCount: affected.length,
    newlyAffectedCount: newlyAffected,
    totalCount,
    affectedAmount,
    totalAmount,
    severity: severityOf({
      affectedCount,
      totalCount,
      affectedAmount,
      totalAmount,
      newlyAffected,
    }),
    noteKey,
    noteValues: { affected: affected.length, total: totalCount, current, next },
    affected,
  }
}

/** Roll several changes up into the number the queue row headlines. */
export function summarizeImpacts(impacts: Impact[]): {
  affectedCount: number
  severity: ImpactSeverity
} {
  const worst = impacts.reduce<ImpactSeverity>((acc, i) => rank(i.severity) > rank(acc) ? i.severity : acc, 'none')
  const affectedCount = impacts.reduce((max, i) => Math.max(max, i.affectedCount), 0)
  return { affectedCount, severity: worst }
}

function severityOf(input: {
  affectedCount: number
  totalCount: number
  affectedAmount: number
  totalAmount: number
  newlyAffected: number
}): ImpactSeverity {
  const { affectedCount, totalCount, affectedAmount, totalAmount, newlyAffected } = input
  if (affectedCount === 0) return 'none'
  if (newlyAffected === 0) return 'low'
  const byCount = totalCount > 0 && affectedCount / totalCount >= HIGH_AFFECTED_RATIO
  const byAmount = totalAmount > 0 && affectedAmount / totalAmount >= HIGH_AFFECTED_RATIO
  return byCount || byAmount ? 'high' : 'low'
}

function rank(severity: ImpactSeverity): number {
  return severity === 'high' ? 2 : severity === 'low' ? 1 : 0
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}
