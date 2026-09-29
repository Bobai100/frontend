import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@/test/render'
import { TimelockQueue } from './TimelockQueue'
import type { Position } from '@/lib/governance/impact'
import type { GovernanceRole, TimelockAction } from '@/lib/governance/timelock'

/**
 * Queue-state tests (#90).
 *
 * The row UI is exercised through the `TimelockQueue` props (actions, role,
 * permissionless, fixed `nowMs`, injected callbacks), so every state — queued,
 * ready, expired — is tested without a wallet, a contract, or a live clock.
 */

const NOW = Date.UTC(2026, 5, 1, 12, 0, 0)
const HOUR = 3_600_000
const DAY = 24 * HOUR

const positions: Position[] = [
  { id: 1, name: 'Sokoto community solar', credit: 82, green: 91, fundedAmount: 420_000 },
  { id: 2, name: 'Ría de Vigo tidal array', credit: 74, green: 88, fundedAmount: 1_180_000 },
  { id: 3, name: 'Atacama agrivoltaics', credit: 88, green: 79, fundedAmount: 640_000 },
  { id: 4, name: 'Jämtland wind co-op', credit: 91, green: 84, fundedAmount: 960_000 },
  { id: 5, name: 'Kerala micro-hydro', credit: 69, green: 93, fundedAmount: 310_000 },
  { id: 6, name: 'Oaxaca rooftop network', credit: 77, green: 86, fundedAmount: 520_000 },
]

function makeAction(overrides: Partial<TimelockAction> = {}): TimelockAction {
  return {
    id: '0x01',
    proposalId: 'HBIP-14',
    proposalTitle: 'Raise the credit floor to 80',
    proposer: 'GCRD2…KQ4P',
    queuedAt: NOW - DAY,
    eta: NOW + 2 * DAY,
    changes: [{ key: 'min_credit_score', current: 70, next: 80 }],
    ...overrides,
  }
}

function renderQueue({
  actions = [makeAction()],
  role = 'caller',
  permissionless = true,
  onExecute = vi.fn().mockResolvedValue('tx123'),
  onCancel = vi.fn().mockResolvedValue('txc321'),
}: {
  actions?: TimelockAction[]
  role?: GovernanceRole
  permissionless?: boolean
  onExecute?: (action: TimelockAction) => Promise<string>
  onCancel?: (action: TimelockAction) => Promise<string>
} = {}) {
  render(
    <TimelockQueue
      actions={actions}
      positions={positions}
      role={role}
      permissionless={permissionless}
      nowMs={NOW}
      onExecute={onExecute}
      onCancel={onCancel}
    />,
  )
  return { onExecute, onCancel }
}

describe('TimelockQueue — queued (before ETA)', () => {
  it('shows the ETA countdown, disables execute, and offers Cancel to a guardian', () => {
    renderQueue({ role: 'guardian' })
    expect(screen.getByText('Waiting for ETA')).toBeInTheDocument()
    expect(screen.getByText('until ETA')).toBeInTheDocument()
    const executeBtn = screen.getByRole('button', { name: 'Execute' })
    expect(executeBtn).toBeDisabled()
    expect(executeBtn).toHaveAttribute(
      'title',
      'Not executable until the ETA passes. A guardian can still cancel it.',
    )
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })

  it('hides Cancel from a caller', () => {
    renderQueue()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })
})

describe('TimelockQueue — ready (ETA passed, within grace)', () => {
  it('lets any connected caller execute when permissionless', () => {
    renderQueue({ actions: [makeAction({ eta: NOW - HOUR })] })
    expect(screen.getByText('Executable')).toBeInTheDocument()
    expect(screen.getByText('left to execute')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Execute' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('disabled for a caller when the controller is not permissionless', () => {
    renderQueue({ actions: [makeAction({ eta: NOW - HOUR })], permissionless: false })
    const executeBtn = screen.getByRole('button', { name: 'Execute' })
    expect(executeBtn).toBeDisabled()
    expect(executeBtn).toHaveAttribute(
      'title',
      'Execution is restricted to the guardian role.',
    )
  })

  it('still lets a guardian execute when the controller is not permissionless', () => {
    renderQueue({ actions: [makeAction({ eta: NOW - HOUR })], permissionless: false, role: 'guardian' })
    expect(screen.getByRole('button', { name: 'Execute' })).toBeEnabled()
  })

  it('cannot be executed by a disconnected reader even when permissionless', () => {
    renderQueue({ actions: [makeAction({ eta: NOW - HOUR })], role: 'anonymous' })
    expect(screen.getByRole('button', { name: 'Execute' })).toBeDisabled()
  })

  it('no longer offers Cancel to a guardian once the ETA has passed', () => {
    renderQueue({ actions: [makeAction({ eta: NOW - HOUR })], role: 'guardian' })
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })
})

describe('TimelockQueue — expired (ETA + grace passed)', () => {
  it('shows a lapsed row with both controls removed and an explanation', () => {
    renderQueue({ actions: [makeAction({ eta: NOW - 7 * HOUR })], role: 'guardian' })
    // "Lapsed" renders as the expired stat *and* the row badge.
    expect(screen.getAllByText('Lapsed').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Window closed')).toBeInTheDocument()
    expect(
      screen.getByText(
        'The ETA passed and the execution window has closed, so this change will not take effect.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Execute' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })
})

describe('TimelockQueue — parameter diff and impact', () => {
  it('shows current vs pending values with the investor impact note', () => {
    renderQueue()
    expect(screen.getByText('Now')).toBeInTheDocument()
    expect(screen.getByText('On execution')).toBeInTheDocument()
    expect(screen.getByText('Minimum credit score')).toBeInTheDocument()
    expect(screen.getByText('70')).toBeInTheDocument()
    expect(screen.getByText('80')).toBeInTheDocument()
    expect(
      screen.getByText(
        /3 of your 6 open positions fall below the new credit floor of 80\./,
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/3 of your open positions are affected/)).toBeInTheDocument()
  })

  it('renders an empty diff row when an action changes no parameters', () => {
    renderQueue({ actions: [makeAction({ changes: [] })] })
    expect(screen.getByText('This action changes no parameters.')).toBeInTheDocument()
  })
})

describe('TimelockQueue — execute and cancel flow', () => {
  it('executes a ready action and moves it to the executed-changes history', async () => {
    const { onExecute } = renderQueue({ actions: [makeAction({ eta: NOW - HOUR })] })
    expect(screen.queryByText('Executed')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Execute' }))

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1))
    const action = onExecute.mock.calls[0][0] as TimelockAction
    expect(action.id).toBe('0x01')

    await waitFor(() => expect(screen.getByText('Executed')).toBeInTheDocument())
    expect(
      screen.getByText(/HBIP-14 executed — the new parameter values are now in force\./),
    ).toBeInTheDocument()
    // The queue row is gone once executed.
    expect(screen.queryByText('Executable')).not.toBeInTheDocument()
  })

  it('cancels a queued action as a guardian and records it in history', async () => {
    const { onCancel } = renderQueue({ role: 'guardian' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText(/cancelled and will never take effect\./)).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('Cancelled')).toBeInTheDocument())
    expect(screen.getByText(/Cancelled by guardian/)).toBeInTheDocument()
  })

  it('surfaces a failed submit as an ember toast and keeps the row queued', async () => {
    const { onExecute } = renderQueue({
      actions: [makeAction({ eta: NOW - HOUR })],
      onExecute: vi.fn().mockRejectedValue(new Error('Simulation failed: boom')),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Execute' }))

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('Could not submit')).toBeInTheDocument())
    expect(screen.getByText('Simulation failed: boom')).toBeInTheDocument()
    expect(screen.queryByText('Executed')).not.toBeInTheDocument()
  })
})

describe('TimelockQueue — empty states', () => {
  it('explains when nothing is queued and nothing has executed', () => {
    renderQueue({ actions: [] })
    expect(screen.getByText(/Nothing is queued/)).toBeInTheDocument()
    expect(screen.getByText(/No governance change has executed yet/)).toBeInTheDocument()
  })

  it('summarises multiple queued actions in the header stats', () => {
    const second = makeAction({
      id: '0x02',
      proposalId: 'HBIP-15',
      proposalTitle: 'Cap single-project allocation at $1.2M',
      eta: NOW + 3 * DAY,
      changes: [{ key: 'max_project_allocation', current: 1_500_000, next: 1_200_000 }],
    })
    renderQueue({ actions: [makeAction(), second], role: 'guardian' })
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('HBIP-15')).toBeInTheDocument()
  })
})