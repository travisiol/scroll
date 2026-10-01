/**
 * The boundary between SCROLL's reward ledger and whatever moves tokens.
 * The ledger never calls a chain directly; the worker drives an adapter
 * through three steps, each of which is safe to repeat:
 *
 *   prepare   → sign a transfer and return its hash WITHOUT sending it.
 *               The worker stores the hash before anything is broadcast.
 *   broadcast → send those exact signed bytes. Sending the same bytes again
 *               can't create a second transfer.
 *   check     → report what the network knows about that hash.
 */

export interface TransferRequest {
  chainId: number;
  token: string;
  to: string;
  /** Base units. */
  amount: bigint;
  ticker: string;
}

export interface PreparedTransfer {
  sender: string;
  nonce: number;
  txHash: string;
  rawTx: string;
}

export type CheckResult =
  | { status: "confirmed"; blockNumber: number }
  /** Seen by the network (pending, or mined but short of the confirmation count). */
  | { status: "pending" }
  | { status: "reverted"; reason: string }
  /** Unknown to the network and its nonce is still free: safe to broadcast the same bytes again. */
  | { status: "missing" }
  /** Unknown to the network and its nonce was used by something else: it can never land. */
  | { status: "nonce_consumed" };

export interface PayoutAdapter {
  name: string;
  sender(): string;
  /** Throws PayoutSetupError when a transfer can't be prepared (balance, RPC, configuration). */
  prepare(request: TransferRequest, floorNonce: number): Promise<PreparedTransfer>;
  broadcast(prepared: PreparedTransfer): Promise<void>;
  check(prepared: PreparedTransfer, request: TransferRequest): Promise<CheckResult>;
}

/** Nothing was sent; the job stays queued and the message is shown to admins. */
export class PayoutSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayoutSetupError";
  }
}

export type AdapterAvailability = { adapter: PayoutAdapter; missing: [] } | { adapter: null; missing: string[] };
