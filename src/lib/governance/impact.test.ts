import { describe, it, expect } from 'vitest'
import { calculateImpact, summarizeImpacts, type Position } from './impact'
import type { ParameterChange } from './timelock'

/**
 * Impact calculator (#90) — the "what does this queued change do to MY money"
 * number shown under every diff row. Pure functions, so no wallet or contract.
 */

const positions: Position[] = [
  { id: 1, name: 'Sokoto community solar', credit: 82, green: 91, fundedAmount: 420_000 },
  { id: 2, name: 'Ría de Vigo tidal array', credit: 74, green: 88, fundedAmount: 1_180_000 },
  { id: 3, name: 'Atacama agrivoltaics', credit: 88, green: 79, fundedAmount: 640_000 },
  { id: 4, name: 'Jämtland wind co-op', credit: 91, green: 84, fundedAmount: 960_000 },
  { id: 5, name: 'Kerala micro-hydro', credit: 69, green: 93, fundedAmount: 310_000 },
  { id: 6, name: 'Oaxaca rooftop network', credit: 77, green: 86, fundedAmount: 520_000 },
]

const creditChange = (next: number, current = 70): ParameterChange => ({
  key: 'min_credit_score',
  current,
  next,
})

describe('calculateImpact — credit floor', () => {
  it('counts the positions that fall below a raised floor', () => {
    // Below 80: Kerala (69), Ría (74), Oaxaca (77) → 3 of 6.
    const impact = calculateImpact(creditChange(80), positions)
    expect(impact.affectedCount).toBe(3)
    expect(impact.totalCount).toBe(6)
    expect(impact.direction).toBe('tightens')
    expect(impact.noteKey).toBe('impactCreditNote')
    expect(impact.affected.map((p) => p.id)).toEqual([2, 5, 6])
  })

  it('sums only the deployed capital in affected positions', () => {
    const impact = calculateImpact(creditChange(80), positions)
    // 1,180,000 + 310,000 + 520,000
    expect(impact.affectedAmount).toBe(2_010_000)
    expect(impact.totalAmount).toBe(4_030_000)
  })

  it('treats a lowered floor as a loosening that affects nobody', () => {
    const impact = calculateImpact(creditChange(50, 70), positions)
    expect(impact.direction).toBe('loosens')
    expect(impact.affectedCount).toBe(0)
    expect(impact.severity).toBe('none')
  })

  it('is unaffected by a position exactly on the floor (qualifies)', () => {
    // A position with credit exactly 80 still qualifies at a floor of 80.
    const impact = calculateImpact(creditChange(80), positions)
    expect(impact.affected.map((p) => p.credit)).not.toContain(80)
  })

  it('separates newly-affected positions from ones already below the old floor', () => {
    // Kerala (69) is already below the current floor of 70, so raising to 80
    // adds Ría and Oaxaca on top of it.
    const impact = calculateImpact(creditChange(80, 70), positions)
    expect(impact.affectedCount).toBe(3)
    expect(impact.newlyAffectedCount).toBe(2)
  })
})

describe('calculateImpact — green floor', () => {
  it('counts positions below a raised green floor', () => {
    // Below 85: Atacama (79) only.
    const impact = calculateImpact(
      { key: 'min_green_score', current: 60, next: 85 },
      positions,
    )
    expect(impact.affectedCount).toBe(1)
    expect(impact.affected[0].name).toBe('Atacama agrivoltaics')
    expect(impact.noteKey).toBe('impactGreenNote')
  })
})

describe('calculateImpact — per-project allocation cap', () => {
  it('counts positions deployed above a lowered cap', () => {
    // Cap 1.2M: Ría (1.18M) stays under; a 500k cap catches 5 of 6.
    const low = calculateImpact(
      { key: 'max_project_allocation', current: 1_500_000, next: 500_000 },
      positions,
    )
    expect(low.affectedCount).toBe(5)
    expect(low.direction).toBe('tightens')
    expect(low.noteKey).toBe('impactAllocationNote')
  })

  it('treats a raised cap as a loosening that affects nobody', () => {
    const impact = calculateImpact(
      { key: 'max_project_allocation', current: 1_500_000, next: 3_000_000 },
      positions,
    )
    expect(impact.direction).toBe('loosens')
    expect(impact.affectedCount).toBe(0)
  })
})

describe('calculateImpact — pool-wide parameters', () => {
  it('counts every open position for a fee change', () => {
    const impact = calculateImpact(
      { key: 'performance_fee_bps', current: 100, next: 75 },
      positions,
    )
    expect(impact.affectedCount).toBe(positions.length)
    expect(impact.affectedAmount).toBe(impact.totalAmount)
    expect(impact.noteKey).toBe('impactPoolWideNote')
  })

  it('counts every open position for a withdrawal-grace or oracle change', () => {
    for (const key of ['withdrawal_grace_hours', 'oracle_staleness_hours'] as const) {
      const impact = calculateImpact({ key, current: 72, next: 24 }, positions)
      expect(impact.affectedCount).toBe(positions.length)
    }
  })
})

describe('calculateImpact — empty and edge-case books', () => {
  it('reports zero of zero when the investor holds nothing', () => {
    const impact = calculateImpact(creditChange(80), [])
    expect(impact.affectedCount).toBe(0)
    expect(impact.totalCount).toBe(0)
    expect(impact.totalAmount).toBe(0)
    expect(impact.severity).toBe('none')
  })

  it('handles a book with zero-funded positions without dividing by zero', () => {
    const zeroed: Position[] = [
      { id: 9, name: 'Empty', credit: 50, green: 50, fundedAmount: 0 },
    ]
    const impact = calculateImpact(creditChange(80), zeroed)
    expect(impact.affectedAmount).toBe(0)
    // The position was already below the old floor, so nothing is *newly*
    // affected — the change is low impact even though 1 of 1 falls short.
    expect(impact.severity).toBe('low')
  })

  it('marks a broad tightening as high severity', () => {
    const impact = calculateImpact(creditChange(95), positions)
    expect(impact.affectedCount).toBe(5)
    expect(impact.severity).toBe('high')
  })

  it('marks a narrow tightening as low severity', () => {
    const impact = calculateImpact(creditChange(71), positions)
    expect(impact.affectedCount).toBe(1)
    expect(impact.severity).toBe('low')
  })
})

describe('summarizeImpacts', () => {
  it('reports the highest severity across an action with several changes', () => {
    const fee = calculateImpact({ key: 'performance_fee_bps', current: 100, next: 75 }, positions)
    const credit = calculateImpact(creditChange(80), positions)
    const summary = summarizeImpacts([fee, credit])
    expect(summary.severity).toBe('high')
    expect(summary.affectedCount).toBe(positions.length)
  })

  it('reports none for an action whose changes affect nothing', () => {
    const loose = calculateImpact(creditChange(50, 70), positions)
    const summary = summarizeImpacts([loose])
    expect(summary.severity).toBe('none')
    expect(summary.affectedCount).toBe(0)
  })

  it('handles an empty change list', () => {
    expect(summarizeImpacts([])).toEqual({ affectedCount: 0, severity: 'none' })
  })
})
