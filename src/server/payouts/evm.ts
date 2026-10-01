import "server-only";
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, erc20Abi, http, keccak256, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN, PAYOUT_CONFIRMATIONS } from "@/config/network";
import { PayoutSetupError, type CheckResult, type PayoutAdapter, type PreparedTransfer, type TransferRequest } from "./adapter";

/**
 * Direct ERC-20 transfers from the treasury wallet on Robinhood Chain.
 * No custom contract. The key is read from TREASURY_PRIVATE_KEY on the
 * server and never leaves this module.
 *
 * Amounts are raw ERC-20 base units, exactly what transfer() takes.
 */
export const robinhoodChain = defineChain({
  id: CHAIN.id,
  name: CHAIN.name,
  nativeCurrency: CHAIN.nativeCurrency,
  rpcUrls: { default: { http: [process.env.RPC_URL || CHAIN.publicRpcUrl] } },
  blockExplorers: { default: { name: "Blockscout", url: CHAIN.explorerUrl } },
});

export function rpcUrl(): string {
  return process.env.RPC_URL || CHAIN.publicRpcUrl;
}

export function publicClient() {
  return createPublicClient({ chain: robinhoodChain, transport: http(rpcUrl()) });
}

export function treasuryKey(): Hex | null {
  const key = process.env.TREASURY_PRIVATE_KEY?.trim();
  if (!key) return null;
  const hex = key.startsWith("0x") ? key : `0x${key}`;
  return /^0x[0-9a-fA-F]{64}$/.test(hex) ? (hex as Hex) : null;
}

export function treasuryAddress(): string | null {
  const key = treasuryKey();
  return key ? privateKeyToAccount(key).address : null;
}

function message(error: unknown): string {
  const e = error as { shortMessage?: string; message?: string };
  return (e.shortMessage || e.message || "unknown error").slice(0, 300);
}

export function createEvmAdapter(key: Hex): PayoutAdapter {
  const account = privateKeyToAccount(key);
  const reader = publicClient();
  const wallet = createWalletClient({ account, chain: robinhoodChain, transport: http(rpcUrl()) });

  // Only "not found" means not found. An RPC failure must never be read as a missing transaction.
  const notFound = (error: unknown, name: string) => {
    if ((error as { name?: string }).name === name) return null;
    throw error;
  };
  const findReceipt = (hash: Hex) => reader.getTransactionReceipt({ hash }).catch((error) => notFound(error, "TransactionReceiptNotFoundError"));

  return {
    name: "robinhood-chain",
    sender: () => account.address,

    async prepare(request: TransferRequest, floorNonce: number): Promise<PreparedTransfer> {
      if (request.chainId !== CHAIN.id) throw new PayoutSetupError(`Allocation is for chain ${request.chainId}, adapter is on ${CHAIN.id}.`);
      const token = request.token as Hex;
      const to = request.to as Hex;
      try {
        const chainId = await reader.getChainId();
        if (chainId !== CHAIN.id) throw new PayoutSetupError(`RPC answered chain ${chainId}, expected ${CHAIN.id}.`);
        const balance = await reader.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
        if (balance < request.amount) throw new PayoutSetupError(`Treasury holds less ${request.ticker} than this transfer needs.`);
        const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, request.amount] });
        // Simulate first: a token that restricts transfers fails here, before anything is signed.
        await reader.call({ account: account.address, to: token, data });
        const pendingNonce = await reader.getTransactionCount({ address: account.address, blockTag: "pending" });
        const nonce = Math.max(pendingNonce, floorNonce);
        const prepared = await wallet.prepareTransactionRequest({ to: token, data, nonce });
        const rawTx = await wallet.signTransaction(prepared);
        return { sender: account.address, nonce, txHash: keccak256(rawTx), rawTx };
      } catch (error) {
        if (error instanceof PayoutSetupError) throw error;
        throw new PayoutSetupError(`Could not prepare the transfer: ${message(error)}`);
      }
    },

    async broadcast(prepared: PreparedTransfer): Promise<void> {
      try {
        await reader.sendRawTransaction({ serializedTransaction: prepared.rawTx as Hex });
      } catch (error) {
        // "already known" / "nonce too low" mean the node has seen these bytes (or the nonce moved).
        // Either way the next check() decides; nothing is re-signed here.
        if (/already known|nonce too low|already imported|replacement/i.test(message(error))) return;
        throw error;
      }
    },

    async check(prepared: PreparedTransfer, request: TransferRequest): Promise<CheckResult> {
      const hash = prepared.txHash as Hex;
      const receipt = await findReceipt(hash);
      if (receipt) {
        if (receipt.status !== "success") return { status: "reverted", reason: "Transaction reverted on chain." };
        const head = await reader.getBlockNumber();
        if (head - receipt.blockNumber + BigInt(1) < BigInt(PAYOUT_CONFIRMATIONS)) return { status: "pending" };
        // Confirm the receipt really contains the transfer we intended.
        const logs = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs });
        const matched = logs.some(
          (l) => l.address.toLowerCase() === request.token.toLowerCase() && l.args.to.toLowerCase() === request.to.toLowerCase() && l.args.value === request.amount,
        );
        if (!matched) return { status: "reverted", reason: "Mined, but no matching Transfer event was found." };
        return { status: "confirmed", blockNumber: Number(receipt.blockNumber) };
      }
      const known = await reader.getTransaction({ hash }).catch((error) => notFound(error, "TransactionNotFoundError"));
      if (known) return { status: "pending" };
      const mined = await reader.getTransactionCount({ address: prepared.sender as Hex, blockTag: "latest" });
      if (mined <= prepared.nonce) return { status: "missing" };
      // The nonce is used. Look once more before concluding it was used by something else:
      // our own transaction may have been mined between the two reads.
      if (await findReceipt(hash)) return { status: "pending" };
      return { status: "nonce_consumed" };
    },
  };
}
