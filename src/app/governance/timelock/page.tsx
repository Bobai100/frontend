'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card, Button } from '@/components'
import { TimelockQueue } from '@/screens/governance/TimelockQueue'
import { EXECUTED_CHANGES, POSITIONS, TIMELOCK_ACTIONS } from '@/data/governance'
import { useWallet } from '@/wallet/WalletProvider'
import {
  detectGovernanceRole,
  fetchExecutedChanges,
  fetchTimelockQueue,
  isPermissionlessExecution,
  submitCancelAction,
  submitExecuteAction,
  type ExecutedChange,
  type GovernanceRole,
  type TimelockAction,
} from '@/lib/governance/timelock'

/**
 * /governance/timelock — the governance queue (#90).
 *
 * Reads the controller when NEXT_PUBLIC_TIMELOCK_CONTRACT_ID is set and falls
 * back to the typed fixtures otherwise, then hands everything to the presentational
 * <TimelockQueue>, which owns the countdown and the row states.
 */
export default function TimelockPage() {
  const t = useTranslations('Governance')
  const { address, sign, connected, connect } = useWallet()
  const [actions, setActions] = useState<TimelockAction[]>(TIMELOCK_ACTIONS)
  const [history, setHistory] = useState<ExecutedChange[]>(EXECUTED_CHANGES)
  const [role, setRole] = useState<GovernanceRole>('anonymous')
  const [permissionless, setPermissionless] = useState(true)

  const source = address ?? 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [queue, resolved, nextRole, open] = await Promise.all([
        fetchTimelockQueue(source),
        fetchExecutedChanges(source),
        detectGovernanceRole(address),
        isPermissionlessExecution(source),
      ])
      if (cancelled) return
      setActions(queue)
      setHistory(resolved)
      setRole(nextRole)
      setPermissionless(open)
    })()
    return () => {
      cancelled = true
    }
  }, [address, source])

  const onExecute = useCallback(
    async (action: TimelockAction) => {
      if (!address) throw new Error('Connect a wallet to execute this action')
      // The queue owns the on-screen history; this is the raw contract write.
      return submitExecuteAction(action, { sourceAddress: address, sign })
    },
    [address, sign],
  )

  const onCancel = useCallback(
    async (action: TimelockAction) => {
      if (!address) throw new Error('Connect a wallet to cancel this action')
      return submitCancelAction(action, { sourceAddress: address, sign })
    },
    [address, sign],
  )

  return (
    <main
      id="main-content"
      style={{ maxWidth: 1080, margin: '0 auto', padding: '48px 32px 80px' }}
    >
      {!connected && (
        <Card style={{ padding: 20, marginBottom: 20, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <p style={{ margin: 0, flex: '1 1 320px', fontFamily: 'var(--font-body)', fontSize: 'var(--type-small)', color: 'var(--ink-60)' }}>
            {t('connectBanner')}
          </p>
          <Button size="sm" variant="secondary" onClick={() => void connect()}>
            {t('connectWallet')}
          </Button>
        </Card>
      )}

      <TimelockQueue
        actions={actions}
        positions={POSITIONS}
        role={role}
        permissionless={permissionless}
        history={history}
        onExecute={onExecute}
        onCancel={onCancel}
      />
    </main>
  )
}
