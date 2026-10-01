import "server-only";
import { createPublicClient, erc20Abi, http, type Hex } from "viem";
import { TICKERS, type Ticker } from "@/config/apps";
import { CHAIN, TOKENS } from "@/config/network";
import { robinhoodChain, rpcUrl, treasuryAddress } from "./payouts/evm";

export interface TokenCheck {
  ticker: Ticker;
  ok: boolean;
  symbol: string | null;
  decimals: number | null;
  /** Treasury balance in base units, when a treasury key is configured. */
  treasuryBalance: string | null;
  problem: string | null;
}

export interface ChainCheck {
  at: string;
  rpc: string;
  chainOk: boolean;
  chainDetail: string;
  treasury: string | null;
  treasuryEth: string | null;
  tokens: TokenCheck[];
}

const g = globalThis as { __scrollChainCheck?: { at: number; value: ChainCheck } };

/** Read the configured tokens back from the chain. Read-only; cached for a minute. */
export async function chainCheck(force = false): Promise<ChainCheck> {
  if (!force && g.__scrollChainCheck && Date.now() - g.__scrollChainCheck.at < 60_000) return g.__scrollChainCheck.value;
  const client = createPublicClient({ chain: robinhoodChain, transport: http(rpcUrl(), { batch: true, timeout: 8000 }) });
  const treasury = treasuryAddress();
  const value: ChainCheck = { at: new Date().toISOString(), rpc: new URL(rpcUrl()).host, chainOk: false, chainDetail: "", treasury, treasuryEth: null, tokens: [] };
  try {
    const id = await client.getChainId();
    value.chainOk = id === CHAIN.id;
    value.chainDetail = value.chainOk ? `eth_chainId = ${id}` : `eth_chainId = ${id}, expected ${CHAIN.id}`;
    if (treasury) value.treasuryEth = (await client.getBalance({ address: treasury as Hex })).toString();
  } catch (error) {
    value.chainDetail = `RPC did not answer (${error instanceof Error ? error.name : "error"}).`;
  }
  value.tokens = await Promise.all(
    TICKERS.map(async (ticker): Promise<TokenCheck> => {
      const token = TOKENS[ticker];
      if (!value.chainOk) return { ticker, ok: false, symbol: null, decimals: null, treasuryBalance: null, problem: "Network not reachable." };
      try {
        const [symbol, decimals, balance] = await Promise.all([
          client.readContract({ address: token.address, abi: erc20Abi, functionName: "symbol" }),
          client.readContract({ address: token.address, abi: erc20Abi, functionName: "decimals" }),
          treasury ? client.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [treasury as Hex] }) : Promise.resolve(null),
        ]);
        const ok = symbol === ticker && decimals === token.decimals;
        return { ticker, ok, symbol, decimals, treasuryBalance: balance === null ? null : balance.toString(), problem: ok ? null : "On-chain symbol or decimals differ from configuration." };
      } catch (error) {
        return { ticker, ok: false, symbol: null, decimals: null, treasuryBalance: null, problem: `Read failed (${error instanceof Error ? error.name : "error"}).` };
      }
    }),
  );
  g.__scrollChainCheck = { at: Date.now(), value };
  return value;
}
