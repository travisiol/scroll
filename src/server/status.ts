import "server-only";
import { CHAIN } from "@/config/network";
import { rpcUrl } from "./payouts/evm";
import { payoutAdapter } from "./payouts/worker";
import { getSettings } from "./settings";

export type PayoutAvailability = "ready" | "network_down" | "switched_off" | "not_configured";

export interface PayoutStatus {
  state: PayoutAvailability;
  /** Plain-language line for users. */
  message: string;
  /** Exact setup gaps, for admins only. */
  setup: string[];
}

const g = globalThis as { __scrollNet?: { at: number; ok: boolean; detail: string } };

/** Is the settlement network answering, with the chain ID we expect? Cached for a minute. */
export async function networkHealth(now = Date.now()): Promise<{ ok: boolean; detail: string }> {
  if (g.__scrollNet && now - g.__scrollNet.at < 60_000) return g.__scrollNet;
  let ok = false;
  let detail = "";
  try {
    const response = await fetch(rpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    const json = (await response.json()) as { result?: string };
    const id = json.result ? Number.parseInt(json.result, 16) : NaN;
    ok = id === CHAIN.id;
    detail = ok ? `RPC answered chain ${id}.` : `RPC answered chain ${json.result ?? "nothing"}, expected ${CHAIN.id}.`;
  } catch (error) {
    detail = `RPC did not answer (${error instanceof Error ? error.name : "error"}).`;
  }
  g.__scrollNet = { at: now, ok, detail };
  return g.__scrollNet;
}

export async function payoutStatus(): Promise<PayoutStatus> {
  const [settings, adapter] = [await getSettings(), payoutAdapter()];
  const setup = [...adapter.missing];
  if (!settings.payoutsEnabled) setup.push("Payouts are switched off (Admin → Network).");
  if (!adapter.adapter) {
    return { state: "not_configured", message: "Payouts aren't live yet. Approved rewards are recorded on your account and will be sent once payouts are switched on.", setup };
  }
  if (!settings.payoutsEnabled) {
    return { state: "switched_off", message: "Payouts are paused. Approved rewards are recorded on your account and will be sent once payouts resume.", setup };
  }
  const net = await networkHealth();
  if (!net.ok) {
    return { state: "network_down", message: `${CHAIN.name} isn't reachable right now. Your account and rewards are unaffected; transfers resume when it is.`, setup: [net.detail] };
  }
  return { state: "ready", message: `Payouts are on. Approved rewards are sent to your wallet automatically on ${CHAIN.name}.`, setup: [] };
}
