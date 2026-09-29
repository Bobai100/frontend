// Governance parameter registry (#90).
//
// Every value a queued governance action can change is declared once here: how
// it is named, how it is rendered, and which "gate" it is. The queue screen, the
// shared <ParameterDiff> viewer, and the proposal wizard (planned, see #90
// "Related: Proposal Creation Wizard") all read this table, so a new
// parameter is a one-line addition rather than a change in three components.

import { formatDecimal, roundToDecimals } from '@/lib/format'

/** The parameters a HBIP can change. Order drives display order in the diff. */
export const PARAM_KEYS = [
  'min_credit_score',
  'min_green_score',
  'max_project_allocation',
  'performance_fee_bps',
  'withdrawal_grace_hours',
  'oracle_staleness_hours',
] as const

export type ParamKey = (typeof PARAM_KEYS)[number]

/** How a parameter renders and what it means for an investor's positions. */
export type ParamGate = 'credit' | 'green' | 'allocation' | 'fee' | 'liquidity' | 'oracle'

export interface ParamSpec {
  key: ParamKey
  /** i18n key under the `Governance` namespace: `param_<key>`. */
  labelKey: string
  /** i18n key under `Governance`: `paramHint_<key>`. */
  hintKey: string
  gate: ParamGate
  /** Decimal places used when rendering. */
  decimals: number
  /** i18n key under `Governance`: `unit_<unitKey>`. */
  unitKey?: string
  /** Hard bounds enforced by the contract; a proposal outside them is rejected. */
  min: number
  max: number
}

const SPECS: Record<ParamKey, ParamSpec> = {
  min_credit_score: {
    key: 'min_credit_score',
    labelKey: 'param_min_credit_score',
    hintKey: 'paramHint_min_credit_score',
    gate: 'credit',
    decimals: 0,
    min: 0,
    max: 100,
  },
  min_green_score: {
    key: 'min_green_score',
    labelKey: 'param_min_green_score',
    hintKey: 'paramHint_min_green_score',
    gate: 'green',
    decimals: 0,
    min: 0,
    max: 100,
  },
  max_project_allocation: {
    key: 'max_project_allocation',
    labelKey: 'param_max_project_allocation',
    hintKey: 'paramHint_max_project_allocation',
    gate: 'allocation',
    decimals: 0,
    unitKey: 'usd',
    min: 0,
    max: 10_000_000,
  },
  performance_fee_bps: {
    key: 'performance_fee_bps',
    labelKey: 'param_performance_fee_bps',
    hintKey: 'paramHint_performance_fee_bps',
    gate: 'fee',
    decimals: 0,
    unitKey: 'bps',
    min: 0,
    max: 1000,
  },
  withdrawal_grace_hours: {
    key: 'withdrawal_grace_hours',
    labelKey: 'param_withdrawal_grace_hours',
    hintKey: 'paramHint_withdrawal_grace_hours',
    gate: 'liquidity',
    decimals: 0,
    unitKey: 'hours',
    min: 0,
    max: 720,
  },
  oracle_staleness_hours: {
    key: 'oracle_staleness_hours',
    labelKey: 'param_oracle_staleness_hours',
    hintKey: 'paramHint_oracle_staleness_hours',
    gate: 'oracle',
    decimals: 0,
    unitKey: 'hours',
    min: 1,
    max: 336,
  },
}

export const PARAM_SPECS: readonly ParamSpec[] = PARAM_KEYS.map((k) => SPECS[k])

/** Typed accessor; throws on an unknown key so a typo fails loudly in dev. */
export function getParamSpec(key: ParamKey): ParamSpec {
  return SPECS[key]
}

/** True when `value` is inside the contract-enforced bounds for `key`. */
export function isWithinBounds(key: ParamKey, value: number): boolean {
  const spec = SPECS[key]
  return Number.isFinite(value) && value >= spec.min && value <= spec.max
}

export type Params = Record<ParamKey, number>

/**
 * Render a parameter value for humans: thousands separators on USDC, no
 * separators on scores, a `%`-ish suffix for basis points, and an `h` for
 * hours. The unit itself is translated by the caller (`unit_<unitKey>`), so
 * this returns the number only — the diff row composes number + unit.
 */
export function formatParamValue(key: ParamKey, value: number): string {
  const spec = SPECS[key]
  const rounded = roundToDecimals(value, spec.decimals)
  if (spec.unitKey === 'usd') {
    return rounded.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
  }
  if (spec.unitKey === 'bps') {
    return formatDecimal(rounded / 100, 2)
  }
  return formatDecimal(rounded, spec.decimals)
}
