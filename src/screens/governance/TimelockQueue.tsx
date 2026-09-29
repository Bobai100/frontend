'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useTranslations } from 'next-intl'
import { Badge, Button, Card, ParameterDiff, useToast } from '@/components'
import { calculateImpact, summarizeImpacts, type Impact, type Position } from '@/lib/governance/impact'
import { formatCountdown, getActionStatus, type ActionStatus, type GovernanceRole, type ParameterChange, type TimelockAction } from '@/lib/governance/timelock'
import { ExecutedHistory } from './ExecutedHistory'
import type { ExecutedChange } from '@/lib/governance/timelock'

/**
 * TimelockQueue — the governance queue (#90).
 *
 * Every queued action shows who proposed it, the countdown to its ETA, the
 * exact parameter diff it will apply, and what that diff does to *your* open
 * positions. Execute is permissionless once the ETA passes; Cancel is
 * guardian-only and closes at the ETA. An action whose ETA passed but whose
 * execution window has closed is shown as expired — no dead button.
 *
 * Props are injected (actions, positions, role, clock) so the queue states are
 * testable without a wallet, a contract, or a real clock; the route wires the
 * live client in.
 */
export interface TimelockQueueProps {
  actions: TimelockAction[]
  positions: Position[]
  role: GovernanceRole
  /** When false, execution is restricted to the guardian. */
  permissionless?: boolean
  history?: ExecutedChange[]
  /** Fixed clock (epoch ms) for tests; omit to tick with the wall clock. */
  nowMs?: number
  onExecute: (action: TimelockAction) => Promise<string>
  onCancel: (action: TimelockAction) => Promise<string>
}

const TICK_MS = 1000

export function TimelockQueue({
  actions,
  positions,
  role,
  permissionless = true,
  history = [],
  nowMs,
  onExecute,
  onCancel,
}: TimelockQueueProps) {
  const t = useTranslations('Governance')
  const { toast } = useToast()
  const [now, setNow] = useState(() => nowMs ?? Date.now())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [resolved, setResolved] = useState<ExecutedChange[]>([])

  // Live countdown. Skipped when a fixed clock is injected (tests).
  useEffect(() => {
    if (nowMs !== undefined) return
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [nowMs])

  const pending = useMemo(
    () => actions.filter((a) => !resolved.some((r) => r.actionId === a.id)),
    [actions, resolved],
  )

  const statusFor = (action: TimelockAction) => getActionStatus(action, now, { role, permissionless })

  const nextEta = useMemo(
    () => pending.filter((a) => a.eta > now).sort((a, b) => a.eta - b.eta)[0],
    [pending, now],
  )

  const run = async (action: TimelockAction, kind: 'executed' | 'cancelled') => {
    setBusyId(action.id)
    try {
      const hash =
        kind === 'executed' ? await onExecute(action) : await onCancel(action)
      setResolved((rows) => [
        {
          id: `${action.id}-${kind}`,
          actionId: action.id,
          proposalId: action.proposalId,
          proposalTitle: action.proposalTitle,
          resolvedAt: Date.now(),
          actor: kind === 'cancelled' ? 'guardian' : role === 'guardian' ? 'guardian' : 'caller',
          kind,
          changes: action.changes,
          txHash: hash,
        },
        ...rows,
      ])
      toast({
        tone: kind === 'executed' ? 'success' : 'neutral',
        title: kind === 'executed' ? t('toastExecutedTitle') : t('toastCancelledTitle'),
        message: t(kind === 'executed' ? 'toastExecutedMsg' : 'toastCancelledMsg', {
          proposal: action.proposalId,
        }),
      })
    } catch (e) {
      toast({
        tone: 'ember',
        title: t('toastFailedTitle'),
        message: e instanceof Error ? e.message : t('toastFailedMsg'),
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={page}>
      <header style={header}>
        <div>
          <div className="hb-eyebrow" style={{ marginBottom: 8 }}>
            {t('eyebrow')}
          </div>
          <h1 style={pageTitle}>{t('h1')}</h1>
          <p style={{ ...subtext, marginTop: 6, maxWidth: 620 }}>{t('subtitle')}</p>
        </div>
        <Badge tone="testnet">{t('badgeTestnet')}</Badge>
      </header>

      <section style={summaryRow} aria-label={t('queueSummaryLabel')}>
        <SummaryCell label={t('statQueued')} value={String(pending.length)} />
        <SummaryCell
          label={t('statReady')}
          value={String(pending.filter((a) => statusFor(a).state === 'ready').length)}
        />
        <SummaryCell
          label={t('statExpired')}
          value={String(pending.filter((a) => statusFor(a).state === 'expired').length)}
        />
        <SummaryCell
          label={t('statNextEta')}
          value={nextEta ? formatCountdown(nextEta.eta - now) : t('statNextEtaNone')}
          last
        />
      </section>

      <h2 style={sectionTitle}>{t('queueTitle')}</h2>
      <p style={{ ...subtext, marginTop: 4, marginBottom: 16 }}>{t('queueCaption')}</p>

      {pending.length === 0 ? (
        <Card style={{ padding: 24 }}>
          <p style={{ ...subtext, margin: 0 }}>{t('queueEmpty')}</p>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {pending.map((action) => (
            <QueueRow
              key={action.id}
              action={action}
              status={getActionStatus(action, now, { role, permissionless })}
              positions={positions}
              busy={busyId === action.id}
              onExecute={() => void run(action, 'executed')}
              onCancel={() => void run(action, 'cancelled')}
            />
          ))}
        </div>
      )}

      <ExecutedHistory entries={[...resolved, ...history]} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface QueueRowProps {
  action: TimelockAction
  status: ActionStatus
  positions: Position[]
  busy: boolean
  onExecute: () => void
  onCancel: () => void
}

function QueueRow({ action, status, positions, busy, onExecute, onCancel }: QueueRowProps) {
  const t = useTranslations('Governance')
  const impacts = useMemo(
    () => action.changes.map((c) => calculateImpact(c, positions)),
    [action.changes, positions],
  )
  const summary = summarizeImpacts(impacts)

  const badge =
    status.state === 'ready' ? (
      <Badge tone="growth">{t('stateReady')}</Badge>
    ) : status.state === 'expired' ? (
      <Badge tone="ember">{t('stateExpired')}</Badge>
    ) : (
      <Badge tone="neutral">{t('stateQueued')}</Badge>
    )

  return (
    <Card
      style={{
        padding: 22,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        opacity: status.state === 'expired' ? 0.75 : 1,
      }}
    >
      <div style={rowHeader}>
        <div style={{ minWidth: 240, flex: '1 1 320px' }}>
          <div style={proposalId}>{action.proposalId}</div>
          <h3 style={actionTitle}>{action.proposalTitle}</h3>
          <div style={rowMeta}>
            <span>{t('queuedBy', { proposer: action.proposer })}</span>
            <span aria-hidden="true">·</span>
            <span>{t('queuedAt', { when: formatDateTime(action.queuedAt) })}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          {badge}
          <Countdown status={status} />
        </div>
      </div>

      <ParameterDiff
        changes={action.changes}
        beforeLabel={t('labelCurrent')}
        afterLabel={t('labelPending')}
        emptyLabel={t('noChanges')}
        renderNote={(change: ParameterChange) => (
          <ImpactNote impact={impacts.find((i) => i.param === change.key)} />
        )}
      />

      {summary.affectedCount > 0 && (
        <p style={{ ...subtext, margin: 0, color: 'var(--ember)' }}>
          {t('summaryAffected', { count: summary.affectedCount })}
        </p>
      )}

      <div style={rowFooter}>
        {status.blockKey && (
          <p style={{ ...subtext, margin: 0, flex: '1 1 240px' }}>{t(status.blockKey)}</p>
        )}
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
          {status.canCancel && (
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              onClick={onCancel}
              reason={t('reasonGuardianOnly')}
            >
              {t('actionCancel')}
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={!status.canExecute}
            reason={status.blockKey ? t(status.blockKey) : undefined}
            onClick={onExecute}
          >
            {t('actionExecute')}
          </Button>
        </div>
      </div>
    </Card>
  )
}

/**
 * The countdown. Ready rows show the remaining execution window instead of a
 * countdown to an ETA that has passed — that window is what the trader is
 * actually racing.
 */
function Countdown({ status }: { status: ActionStatus }) {
  const t = useTranslations('Governance')
  const [value, caption] =
    status.state === 'ready'
      ? [formatCountdown(status.msGraceLeft), t('labelGraceLeft')]
      : status.state === 'expired'
        ? [t('labelWindowClosed'), t('labelEta')]
        : [formatCountdown(status.msUntilEta), t('labelEtaIn')]

  return (
    <div style={{ textAlign: 'right' }}>
      <div style={countdownValue}>{value}</div>
      <div style={countdownCaption}>{caption}</div>
    </div>
  )
}

function ImpactNote({ impact }: { impact: Impact | undefined }) {
  const t = useTranslations('Governance')
  if (!impact) return null

  const { noteValues, severity, affected } = impact
  const color = severity === 'high' ? 'var(--ember)' : 'var(--ink-60)'

  if (impact.affectedCount === 0) {
    return (
      <p style={{ ...noteText, color }}>
        {t(impact.noteKey, { ...noteValues })}
      </p>
    )
  }

  return (
    <p style={{ ...noteText, color }}>
      {t(impact.noteKey, { ...noteValues })}
      {affected.length > 0 && (
        <span style={{ color: 'var(--ink-40)' }}>
          {' '}
          {t('impactAffectedList', { names: affected.map((p) => p.name).join(', ') })}
        </span>
      )}
    </p>
  )
}

function SummaryCell({
  label,
  value,
  last,
}: {
  label: string
  value: string
  last?: boolean
}) {
  return (
    <div style={{ flex: '1 1 0', minWidth: 150, padding: '14px 16px', borderRight: last ? 'none' : '1px solid var(--ink-12)' }}>
      <div className="hb-eyebrow" style={{ marginBottom: 6 }}>
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-data)',
          fontWeight: 600,
          fontSize: 'var(--type-h4)',
          color: 'var(--ink)',
          fontFeatureSettings: '"tnum" 1',
        }}
      >
        {value}
      </div>
    </div>
  )
}

function formatDateTime(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
}

// --- styles -----------------------------------------------------------------

const page: CSSProperties = { fontFamily: 'var(--font-body)', color: 'var(--ink)' }

const header: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
  flexWrap: 'wrap',
  marginBottom: 20,
}

const pageTitle: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 700,
  fontSize: 'var(--type-h2)',
  margin: 0,
  color: 'var(--ink)',
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

const summaryRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  background: 'var(--surface)',
  border: '1px solid var(--ink-12)',
  borderRadius: 'var(--radius-card)',
  boxShadow: 'var(--shadow-sm)',
  marginBottom: 8,
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

const actionTitle: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 700,
  fontSize: 'var(--type-body-lg)',
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

const countdownValue: CSSProperties = {
  fontFamily: 'var(--font-data)',
  fontWeight: 600,
  fontSize: 'var(--type-h4)',
  color: 'var(--ink)',
  fontFeatureSettings: '"tnum" 1',
  whiteSpace: 'nowrap',
}

const countdownCaption: CSSProperties = {
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--type-eyebrow)',
  color: 'var(--ink-40)',
}

const noteText: CSSProperties = {
  margin: '0 0 4px',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--type-caption)',
  lineHeight: 1.5,
  textAlign: 'left',
}

const rowFooter: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
  borderTop: '1px solid var(--ink-12)',
  paddingTop: 14,
}
