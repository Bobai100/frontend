// Heliobond — governance (timelock) fixtures for the queue + history surface.
// Not production: these stand in for reads from the Soroban `TimelockController`
// (`get_queue`, `get_history`, `get_params`). No Math.random; ETAs are offsets
// from module load so the click-through always shows a live countdown, an
// executable action, and one that has already lapsed past its grace window.

import { HB_DATA, type Project } from '@/data'
import type { Params } from '@/lib/governance/params'
import type { ExecutedChange, TimelockAction } from '@/lib/governance/timelock'
import type { Position } from '@/lib/governance/impact'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const NOW = Date.now()

/** Parameter values in force right now — the "before" column of every diff. */
export const CURRENT_PARAMS: Params = {
  min_credit_score: 70,
  min_green_score: 60,
  max_project_allocation: 1_500_000,
  performance_fee_bps: 100,
  withdrawal_grace_hours: 72,
  oracle_staleness_hours: 168,
}

/** The investor's open positions — pool exposure, per project. */
export const POSITIONS: Position[] = HB_DATA.projects.map((p: Project) => ({
  id: p.id,
  name: p.name,
  credit: p.credit,
  green: p.green,
  fundedAmount: p.fundedAmount,
}))

/** Demo guardian — the connected demo wallet holds the guardian role. */
export const DEMO_GUARDIAN = 'GBQHWXVZ2K4M6N8P3R5T7W9YA2C4E6G8J3L5Q7S9U2X4Z6B8D1F3H59XQ'

/**
 * Pending queue. One action per state the row UI must handle: executable now,
 * counting down, counting down, and past its grace window.
 */
export const TIMELOCK_ACTIONS: TimelockAction[] = [
  {
    id: '0x01',
    proposalId: 'HBIP-14',
    proposalTitle: 'Raise the credit floor to 80 after two quarters of drift',
    proposer: 'GCRD2…KQ4P',
    queuedAt: NOW - 3 * DAY,
    eta: NOW - 25 * MINUTE,
    changes: [{ key: 'min_credit_score', current: 70, next: 80 }],
  },
  {
    id: '0x02',
    proposalId: 'HBIP-15',
    proposalTitle: 'Cap single-project allocation at $1.2M',
    proposer: 'GCVA1…8TQD',
    queuedAt: NOW - 6 * HOUR,
    eta: NOW + 2 * DAY + 4 * HOUR + 13 * MINUTE,
    changes: [
      { key: 'max_project_allocation', current: 1_500_000, next: 1_200_000 },
      { key: 'min_green_score', current: 60, next: 70 },
    ],
  },
  {
    id: '0x03',
    proposalId: 'HBIP-16',
    proposalTitle: 'Cut the performance fee to 0.75%',
    proposer: 'GFEE8…LM2Z',
    queuedAt: NOW - 40 * MINUTE,
    eta: NOW + 5 * HOUR + 12 * MINUTE,
    changes: [{ key: 'performance_fee_bps', current: 100, next: 75 }],
  },
  {
    id: '0x04',
    proposalId: 'HBIP-13',
    proposalTitle: 'Shorten the withdrawal grace period to 24h',
    proposer: 'GOLD…5RB1',
    queuedAt: NOW - 8 * DAY,
    // ETA passed long ago and the 6h execution window has closed: the action
    // lapses instead of executing. The queue must say so rather than offer a
    // button that would revert on-chain.
    eta: NOW - 3 * DAY,
    changes: [{ key: 'withdrawal_grace_hours', current: 72, next: 24 }],
  },
]

/** Executed + cancelled actions, newest first — the "what actually changed" log. */
export const EXECUTED_CHANGES: ExecutedChange[] = [
  {
    id: '0x00-2',
    actionId: '0x00',
    proposalId: 'HBIP-12',
    proposalTitle: 'Require a fresh oracle reading every 14 days',
    resolvedAt: NOW - 6 * DAY,
    actor: 'GCVA1…8TQD',
    kind: 'executed',
    changes: [{ key: 'oracle_staleness_hours', current: 720, next: 336 }],
    txHash: 'c91f…40ab',
  },
  {
    id: '0x00-1',
    actionId: '0x00',
    proposalId: 'HBIP-11',
    proposalTitle: 'Green floor to 60 for new registrations',
    resolvedAt: NOW - 12 * DAY,
    actor: 'GCRD2…KQ4P',
    kind: 'executed',
    changes: [{ key: 'min_green_score', current: 50, next: 60 }],
    txHash: '5d3e…9c71',
  },
  {
    id: '0x0a-1',
    actionId: '0x0a',
    proposalId: 'HBIP-09',
    proposalTitle: 'Temporary performance-fee holiday',
    resolvedAt: NOW - 21 * DAY,
    actor: DEMO_GUARDIAN,
    kind: 'cancelled',
    changes: [{ key: 'performance_fee_bps', current: 100, next: 0 }],
    txHash: 'b74a…2e19',
  },
]
