/**
 * Settlement network and reward tokens. Nothing here is guessed.
 *
 * - Chain ID, public RPC and explorer: official Robinhood Chain docs
 *   (https://docs.robinhood.com/chain/connecting), and the chain ID was read
 *   back from the RPC with eth_chainId (0x1237 = 4663).
 * - Token addresses: Robinhood's official asset list
 *   (GET https://api.robinhood.com/rhj/assets, read 2026-10-01, all five
 *   ASSET_STATUS_ACTIVE on chain 4663), then symbol() and decimals() were
 *   read from each contract at block 77,594,181.
 *
 * `npm run verify:tokens` repeats both checks. The docs call the public RPC
 * rate-limited and not for production: set RPC_URL to a dedicated endpoint.
 */
import type { Ticker } from "./apps";

export const CHAIN = {
  id: 4663,
  name: "Robinhood Chain",
  publicRpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  explorerUrl: "https://robinhoodchain.blockscout.com",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
} as const;

export interface RewardToken {
  ticker: Ticker;
  /** name() as listed by the issuer. */
  name: string;
  address: `0x${string}`;
  decimals: number;
}

export const VERIFIED_AT_BLOCK = 77_594_181;

export const TOKENS: Record<Ticker, RewardToken> = {
  META: { ticker: "META", name: "Meta Platforms • Robinhood Token", address: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", decimals: 18 },
  SNAP: { ticker: "SNAP", name: "Snap • Robinhood Token", address: "0xF6589F11Bc40b669e584073F428B05562F568733", decimals: 18 },
  RDDT: { ticker: "RDDT", name: "Reddit • Robinhood Token", address: "0x05b37Fb53A299a1b874A619e1c4C404D52C36F4C", decimals: 18 },
  NFLX: { ticker: "NFLX", name: "Netflix • Robinhood Token", address: "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8", decimals: 18 },
  RBLX: { ticker: "RBLX", name: "Roblox • Robinhood Token", address: "0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8", decimals: 18 },
};

/** Confirmations required before a transfer counts as paid. */
export const PAYOUT_CONFIRMATIONS = 3;

export function explorerTx(hash: string): string {
  return `${CHAIN.explorerUrl}/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  return `${CHAIN.explorerUrl}/address/${address}`;
}
