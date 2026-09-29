// Shared network constants + polling for the Soroban write pipeline.
// Extracted from src/wallet/vault.ts for the governance surface (#90); the
// vault client keeps its own inline copies so existing behaviour is untouched.

export const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org'
export const HORIZON_URL = 'https://horizon-testnet.stellar.org'

/** Seconds to poll getTransaction before giving up. */
const TX_POLL_TIMEOUT_S = 30

/** Poll until a submitted transaction reaches a terminal status. */
export async function waitForTransaction(hash: string): Promise<void> {
  const { rpc } = await import('@stellar/stellar-sdk')
  const server = new rpc.Server(RPC_URL, { allowHttp: false })
  const deadline = Date.now() + TX_POLL_TIMEOUT_S * 1000

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000))
    const result = await server.getTransaction(hash)
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) return
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error('Transaction failed on-chain')
    }
    // NOT_FOUND means still pending — keep polling
  }
  throw new Error('Transaction confirmation timed out')
}

/**
 * Demo-mode result: a placeholder hash after `delayMs`, abortable. Used when no
 * contract id is configured so the click-through behaves like a real write
 * without touching the network.
 */
export function demoHashAfter(delayMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve(
        `demo${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}…${Math.random().toString(36).slice(2, 8)}`,
      )
    }, delayMs)
    const abort = () => {
      clearTimeout(timer)
      reject(new Error('Aborted'))
    }
    if (signal) {
      signal.addEventListener('abort', abort)
      if (signal.aborted) {
        clearTimeout(timer)
        reject(new Error('Aborted'))
      }
    }
  })
}
