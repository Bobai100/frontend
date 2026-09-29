// Generic "call a Soroban contract" pipeline — build → simulate → assemble →
// sign → submit → poll (#90).
//
// src/wallet/vault.ts keeps its own copy of this lifecycle because it was
// written before the governance surface existed; the governance timelock client
// (`src/lib/governance/timelock.ts`) uses this module instead so execute/cancel
// follow the same five steps documented in ARCHITECTURE.md §4 — the timelock is
// only trustworthy if its writes are surfaced exactly like the vault's.
//
// In demo mode (no contract id configured) the call resolves to a placeholder
// hash after a short delay, mirroring the vault client's behaviour, so the
// click-through never surfaces an error.

import { RPC_URL, HORIZON_URL, waitForTransaction, demoHashAfter } from './txSupport'

export interface ContractCallRequest {
  /** Deployed contract to invoke. */
  contractId: string
  /** Contract method, e.g. `execute`. */
  method: string
  /** Native (JS) arguments — converted with `nativeToScVal` before the call. */
  args?: unknown[]
  /** Source account of the transaction. */
  sourceAddress: string
  /** Signing function from WalletProvider. */
  sign: (xdr: string) => Promise<string>
  signal?: AbortSignal
  /** Simulated pending delay used when `contractId` is not configured. */
  demoDelayMs?: number
}

/**
 * Build, sign, and submit a single contract call. Returns the transaction hash
 * (real, or a demo placeholder when the contract is not configured).
 */
export async function submitContractCall({
  contractId,
  method,
  args = [],
  sourceAddress,
  sign,
  signal,
  demoDelayMs = 2000,
}: ContractCallRequest): Promise<string> {
  if (!contractId) return demoHashAfter(demoDelayMs, signal)

  const { rpc, Contract, TransactionBuilder, Networks, Horizon, nativeToScVal, Transaction } =
    await import('@stellar/stellar-sdk')

  const server = new rpc.Server(RPC_URL, { allowHttp: false })
  const horizon = new Horizon.Server(HORIZON_URL)
  const contract = new Contract(contractId)

  const account = await horizon.loadAccount(sourceAddress)
  const scArgs = args.map((a) => nativeToScVal(a))

  const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(contract.call(method, ...scArgs))
    .setTimeout(180)
    .build()

  const simResult = await server.simulateTransaction(tx)
  if ('error' in simResult) throw new Error(`Simulation failed: ${simResult.error}`)

  const assembled = rpc.assembleTransaction(tx, simResult).build()
  const signedXdr = await sign(assembled.toXDR())
  const signedTx = new Transaction(signedXdr, Networks.TESTNET)

  const sendResult = await server.sendTransaction(signedTx)
  if (sendResult.status === 'ERROR') {
    throw new Error(`Send failed: ${JSON.stringify(sendResult.errorResult)}`)
  }

  await waitForTransaction(sendResult.hash)
  return sendResult.hash
}
