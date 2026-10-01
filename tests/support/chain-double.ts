import { createHash, randomBytes } from "node:crypto";
import { PayoutSetupError, type CheckResult, type PayoutAdapter, type PreparedTransfer, type TransferRequest } from "@/server/payouts/adapter";

/**
 * A test double for a chain. It moves nothing and is only ever imported by
 * the tests. It behaves like a network with one sender account: nonces are
 * consumed in order, a broadcast is idempotent per hash, and the `transfers`
 * list records every transfer that would really have happened, which is what
 * the duplicate-payment tests assert on.
 */
export class ChainDouble implements PayoutAdapter {
  name = "test-double";

  /** Every transfer the "network" accepted, in order. */
  transfers: { txHash: string; nonce: number; to: string; token: string; amount: bigint }[] = [];
  balances = new Map<string, bigint>();
  /** check() calls needed after broadcast before a transfer confirms. */
  confirmAfterChecks = 1;

  // Fault injection for tests.
  failNextBroadcast = false;
  crashAfterBroadcast = false;
  revertNext = false;
  enforceBalances = false;

  private pending = new Map<string, { checks: number; reverted: boolean; request: PreparedTransfer }>();
  private prepared = new Map<string, TransferRequest>();
  private block = 1000;

  sender(): string {
    return "0x5151515151515151515151515151515151515151";
  }

  chainNonce(): number {
    return this.transfers.length;
  }

  async prepare(request: TransferRequest, floorNonce: number): Promise<PreparedTransfer> {
    if (this.enforceBalances && (this.balances.get(request.ticker) ?? BigInt(0)) < request.amount) {
      throw new PayoutSetupError(`Treasury holds less ${request.ticker} than this transfer needs.`);
    }
    const nonce = Math.max(floorNonce, this.chainNonce());
    const rawTx = `0x${randomBytes(48).toString("hex")}`;
    const txHash = `0x${createHash("sha256").update(rawTx).digest("hex")}`;
    this.prepared.set(txHash, request);
    return { sender: this.sender(), nonce, txHash, rawTx };
  }

  async broadcast(prepared: PreparedTransfer): Promise<void> {
    if (this.failNextBroadcast) {
      this.failNextBroadcast = false;
      throw new Error("test network error");
    }
    if (!this.pending.has(prepared.txHash) && !this.transfers.some((t) => t.txHash === prepared.txHash)) {
      if (prepared.nonce !== this.chainNonce() + this.pending.size) {
        // Out-of-order nonce: a real node would hold or reject it. Treat as not accepted.
        throw new Error("test nonce gap");
      }
      this.pending.set(prepared.txHash, { checks: 0, reverted: this.revertNext, request: prepared });
      this.revertNext = false;
    }
    if (this.crashAfterBroadcast) {
      this.crashAfterBroadcast = false;
      throw new Error("test crash after broadcast");
    }
  }

  async check(prepared: PreparedTransfer, fallback?: TransferRequest): Promise<CheckResult> {
    const done = this.transfers.find((t) => t.txHash === prepared.txHash);
    if (done) return { status: "confirmed", blockNumber: this.block };
    const p = this.pending.get(prepared.txHash);
    if (!p) return prepared.nonce < this.chainNonce() ? { status: "nonce_consumed" } : { status: "missing" };
    p.checks += 1;
    if (p.checks < this.confirmAfterChecks) return { status: "pending" };
    this.pending.delete(prepared.txHash);
    const request = this.prepared.get(prepared.txHash) ?? fallback;
    if (p.reverted || !request) {
      // A reverted transaction still uses its nonce.
      this.transfers.push({ txHash: `${prepared.txHash}:reverted`, nonce: prepared.nonce, to: "", token: "", amount: BigInt(0) });
      return { status: "reverted", reason: "test revert" };
    }
    this.block += 1;
    this.transfers.push({ txHash: prepared.txHash, nonce: prepared.nonce, to: request.to, token: request.token, amount: request.amount });
    if (this.enforceBalances) this.balances.set(request.ticker, (this.balances.get(request.ticker) ?? BigInt(0)) - request.amount);
    return { status: "confirmed", blockNumber: this.block };
  }

  /** Real transfers only (reverted placeholders excluded). */
  paid(): { to: string; token: string; amount: bigint; txHash: string }[] {
    return this.transfers.filter((t) => !t.txHash.endsWith(":reverted"));
  }
}
