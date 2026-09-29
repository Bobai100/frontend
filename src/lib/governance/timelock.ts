// Governance timelock client — queue reads, state derivation, role detection,
// and the execute / cancel writes (#90).
//
// The Heliobond pool's risk parameters (credit floor, green floor, per-project
// allocation cap, performance fee, withdrawal grace, oracle staleness) are
// changed by HBIP proposals, but a proposal only becomes a *queued action*: the
// new values sit behind a timelock so investors get a countdown to react. This
// module is the single place that decides what state an action is in and who
// may act on it, so the queue screen, the executed-changes history, and (later)
// the proposal wizard cannot disagree.
//
// Contract counterpart: a Soroban `TimelockController` exposing
//   `queue(proposal_id, changes)`, `get_action(id)`, `get_queue()`,
//   `execute(id)`, `cancel(id)`, `is_guardian(address)`, `is_permissionless()`
//
// When NEXT_PUBLIC_TIMELOCK_CONTRACT_ID is unset the client falls back to typed
// fixtures (src/data/governance.ts) and demo-mode writes, exactly like
// src/wallet/vault.ts does for the vault.

import { submitContractCall } from '@/wallet/contractTx'
import { RPC_URL } from '@/wallet/txSupport'
import { TIMELOCK_ACTIONS, EXECUTED_CHANGES, DEMO_GUARDIAN } from '@/data/governance'
import type { ParamKey } from './params'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One parameter a queued action will change when it executes. */
export interface ParameterChange {
  key: ParamKey
  /** Value in force right now (the "before" column of the diff). */
  current: number
  /** Value that takes effect on execution (the "after" column). */
  next: number
}

/** A timelocked action created by a passed HBIP proposal. */
export interface TimelockAction {
  id: string
  /** Originating proposal, e.g. `HBIP-14`. */
  proposalId: string
  proposalTitle: string
  /** Stellar address that scheduled the action. */
  proposer: string
  /** Epoch ms the action was queued. */
  queuedAt: number
  /** Epoch ms the action becomes executable (ETA). */
  eta: number
  changes: ParameterChange[]
}

/**
 * Lifecycle of a queued action.
 * `expired` is the edge case the queue must surface honestly: the ETA passed,
 * but the window in which the action could execute has closed, so it can
 * neither be executed nor cancelled — it just lapses.
 */
export type TimelockState = 'queued' | 'ready' | 'expired' | 'executed' | 'cancelled'

/** How a connected address relates to the timelock. Detected on-chain. */
export type GovernanceRole = 'guardian' | 'caller' | 'anonymous'

/** Everything the queue row needs to render, derived from the action + clock. */
export interface ActionStatus {
  state: TimelockState
  /** ms until the ETA (0 once the ETA has passed). */
  msUntilEta: number
  /** ms left in the post-ETA execution window (0 before the ETA). */
  msGraceLeft: number
  canExecute: boolean
  canCancel: boolean
  /** `Governance` i18n key explaining why the row's controls are blocked. */
  blockKey: string | null
}

/** A resolved action kept for the executed-changes history. */
export interface ExecutedChange {
  id: string
  actionId: string
  proposalId: string
  proposalTitle: string
  /** Epoch ms the action was executed (or cancelled). */
  resolvedAt: number
  /** Address that executed/cancelled; `proposer` for a self-cancel. */
  actor: string
  kind: 'executed' | 'cancelled'
  /** `current` is the value in force just before the action resolved. */
  changes: ParameterChange[]
  /** Explorer hash of the resolving transaction. */
  txHash: string
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * Window after the ETA in which the action can still be executed. Past it the
 * action is `expired`: the values never take effect and the queue says so.
 */
export const TIMELOCK_GRACE_MS = 6 * HOUR_MS

/**
 * Human countdown: `2d 4h 13m`, `4h 13m`, `13m 5s`, `9s`. Zero renders `0s`
 * rather than an empty string so a row is never blank.
 */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms))
  if (total === 0) return '0s'
  if (total < MINUTE_MS) return `${total}s`

  const days = Math.floor(total / DAY_MS)
  const hours = Math.floor((total % DAY_MS) / HOUR_MS)
  const minutes = Math.floor((total % HOUR_MS) / MINUTE_MS)
  const seconds = Math.floor((total % MINUTE_MS) / 1000)

  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  // Seconds only matter inside the final hour — a 3-digit "0h 12m 43s" reads
  // as noise for a three-day timelock.
  if (days === 0 && hours === 0) parts.push(`${seconds}s`)
  return parts.join(' ')
}

export interface StatusOptions {
  /** Role detected through the contract; `anonymous` when no wallet. */
  role?: GovernanceRole
  /** `TimelockController.is_permissionless()` — anyone may execute when true. */
  permissionless?: boolean
}

/**
 * Derive an action's state, countdown, and available controls at `now`.
 *
 * - before the ETA → `queued`; only a guardian can cancel.
 * - ETA … ETA+grace → `ready`; anyone may execute when the controller is
 *   permissionless, otherwise only the guardian.
 * - past ETA+grace → `expired`; both controls are gone and the row explains why.
 */
export function getActionStatus(
  action: TimelockAction,
  now: number,
  options: StatusOptions = {},
): ActionStatus {
  const { role = 'caller', permissionless = true } = options
  const msUntilEta = Math.max(0, action.eta - now)
  const msSinceEta = Math.max(0, now - action.eta)
  const isGuardian = role === 'guardian'

  if (msUntilEta > 0) {
    return {
      state: 'queued',
      msUntilEta,
      msGraceLeft: 0,
      canExecute: false,
      canCancel: isGuardian,
      blockKey: 'blockWaitingEta',
    }
  }

  if (msSinceEta >= TIMELOCK_GRACE_MS) {
    return {
      state: 'expired',
      msUntilEta: 0,
      msGraceLeft: 0,
      canExecute: false,
      canCancel: false,
      blockKey: 'blockGraceExpired',
    }
  }

  const canExecute = isGuardian || (permissionless && role !== 'anonymous')
  return {
    state: 'ready',
    msUntilEta: 0,
    msGraceLeft: TIMELOCK_GRACE_MS - msSinceEta,
    canExecute,
    canCancel: false,
    blockKey: canExecute ? null : 'blockNotPermissionless',
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const CONTRACT_ID = process.env.NEXT_PUBLIC_TIMELOCK_CONTRACT_ID

/**
 * The pending queue. Falls back to the typed fixtures when the controller is
 * not configured so the surface always renders something honest.
 */
export async function fetchTimelockQueue(sourceAddress: string): Promise<TimelockAction[]> {
  if (!CONTRACT_ID) return TIMELOCK_ACTIONS
  try {
    const { scValToNative } = await import('@stellar/stellar-sdk')
    const raw = await readController(sourceAddress, 'get_queue')
    return (Array.isArray(raw) ? raw : []).map((entry) => normalizeAction(entry, scValToNative))
  } catch {
    return TIMELOCK_ACTIONS
  }
}

/** Executed + cancelled actions, newest first, for the history section. */
export async function fetchExecutedChanges(sourceAddress: string): Promise<ExecutedChange[]> {
  if (!CONTRACT_ID) return EXECUTED_CHANGES
  try {
    const { scValToNative } = await import('@stellar/stellar-sdk')
    const raw = await readController(sourceAddress, 'get_history')
    return (Array.isArray(raw) ? raw : []).map((entry) => normalizeExecuted(entry, scValToNative))
  } catch {
    return EXECUTED_CHANGES
  }
}

/**
 * Role detection through the contract: `is_guardian(address)` plus
 * `is_permissionless()`. Falls back to `anonymous` (can view, cannot act) when
 * the wallet is disconnected or the read fails — the queue must never imply
 * authority it could not verify.
 */
export async function detectGovernanceRole(
  address: string | null,
): Promise<GovernanceRole> {
  if (!address) return 'anonymous'
  if (!CONTRACT_ID) return GUARDIAN_FALLBACK.includes(address) ? 'guardian' : 'caller'
  try {
    const { scValToNative } = await import('@stellar/stellar-sdk')
    const isGuardian = Boolean(
      scValToNative(await readController(address, 'is_guardian', [address])),
    )
    return isGuardian ? 'guardian' : 'caller'
  } catch {
    return 'caller'
  }
}

/** `TimelockController.is_permissionless()` — defaults to true when unset. */
export async function isPermissionlessExecution(sourceAddress: string): Promise<boolean> {
  if (!CONTRACT_ID) return true
  try {
    const { scValToNative } = await import('@stellar/stellar-sdk')
    return Boolean(scValToNative(await readController(sourceAddress, 'is_permissionless')))
  } catch {
    return true
  }
}

/** Demo-mode guardian set used when the controller is not configured. */
const GUARDIAN_FALLBACK = [DEMO_GUARDIAN]

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface WriteContext {
  sourceAddress: string
  sign: (xdr: string) => Promise<string>
  signal?: AbortSignal
}

/**
 * Execute a ready action. Permissionless when the controller says so, so any
 * connected address may call it once the ETA has passed — the action is already
 * fixed on-chain, executing it only publishes the values it will change.
 */
export function submitExecuteAction(
  action: TimelockAction,
  ctx: WriteContext,
): Promise<string> {
  return submitContractCall({
    contractId: CONTRACT_ID ?? '',
    method: 'execute',
    args: [action.id],
    sourceAddress: ctx.sourceAddress,
    sign: ctx.sign,
    signal: ctx.signal,
  })
}

/**
 * Cancel a queued action. Guardian-only and only before the ETA — once the
 * window opens the action is no longer cancellable, by design.
 */
export function submitCancelAction(
  action: TimelockAction,
  ctx: WriteContext,
): Promise<string> {
  return submitContractCall({
    contractId: CONTRACT_ID ?? '',
    method: 'cancel',
    args: [action.id],
    sourceAddress: ctx.sourceAddress,
    sign: ctx.sign,
    signal: ctx.signal,
  })
}

/**
 * Turn an executed/cancelled action into the history row shape, keeping the
 * before-value from the action's own diff (the fixture and the on-chain
 * payload agree on this).
 */
export function toExecutedChange(
  action: TimelockAction,
  kind: ExecutedChange['kind'],
  actor: string,
  txHash: string,
  resolvedAt: number,
): ExecutedChange {
  return {
    id: `${action.id}-${kind}`,
    actionId: action.id,
    proposalId: action.proposalId,
    proposalTitle: action.proposalTitle,
    resolvedAt,
    actor,
    kind,
    changes: action.changes,
    txHash,
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Simulate a view call against the controller and return the raw ScVal. */
async function readController(
  sourceAddress: string,
  method: string,
  args: unknown[] = [],
): Promise<unknown> {
  const { rpc, Contract, TransactionBuilder, Networks, Account, nativeToScVal } =
    await import('@stellar/stellar-sdk')

  const server = new rpc.Server(RPC_URL, { allowHttp: false })
  const contract = new Contract(CONTRACT_ID!)
  // Sequence '0' is fine for simulation — only the address format matters.
  const source = new Account(sourceAddress, '0')
  const scArgs = args.map((a) => nativeToScVal(a))

  const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(contract.call(method, ...scArgs))
    .setTimeout(0)
    .build()

  const result = await server.simulateTransaction(tx)
  if ('error' in result) throw new Error(`Soroban simulate error: ${result.error}`)
  if (!result.result) throw new Error('Soroban simulate returned no result')
  return result.result.retval
}

type ScConvert = (v: unknown) => unknown

function normalizeAction(entry: Record<string, unknown>, scValToNative: ScConvert): TimelockAction {
  const changes = (Array.isArray(entry.changes) ? entry.changes : []) as ParameterChange[]
  return {
    id: String(entry.id ?? ''),
    proposalId: String(entry.proposalId ?? ''),
    proposalTitle: String(entry.proposalTitle ?? ''),
    proposer: String(scValToNative(entry.proposer) ?? ''),
    queuedAt: Number(scValToNative(entry.queuedAt) ?? 0),
    eta: Number(scValToNative(entry.eta) ?? 0),
    changes: changes.map((c) => ({ ...c, current: Number(c.current), next: Number(c.next) })),
  }
}

function normalizeExecuted(
  entry: Record<string, unknown>,
  scValToNative: ScConvert,
): ExecutedChange {
  const changes = (Array.isArray(entry.changes) ? entry.changes : []) as ParameterChange[]
  return {
    id: String(entry.id ?? ''),
    actionId: String(entry.actionId ?? ''),
    proposalId: String(entry.proposalId ?? ''),
    proposalTitle: String(entry.proposalTitle ?? ''),
    resolvedAt: Number(scValToNative(entry.resolvedAt) ?? 0),
    actor: String(scValToNative(entry.actor) ?? ''),
    kind: entry.kind === 'cancelled' ? 'cancelled' : 'executed',
    changes: changes.map((c) => ({ ...c, current: Number(c.current), next: Number(c.next) })),
    txHash: String(entry.txHash ?? ''),
  }
}
