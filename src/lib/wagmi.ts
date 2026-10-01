import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";
import { CHAIN } from "@/config/network";

export const robinhood = defineChain({
  id: CHAIN.id,
  name: CHAIN.name,
  nativeCurrency: CHAIN.nativeCurrency,
  rpcUrls: { default: { http: [CHAIN.publicRpcUrl] } },
  blockExplorers: { default: { name: "Blockscout", url: CHAIN.explorerUrl } },
});

/**
 * Browser wallets only (EIP-6963 discovery finds every installed one).
 * Signing in needs a signature, not a network: users are never asked to
 * switch chains or approve anything to use the app.
 */
export const wagmiConfig = createConfig({
  chains: [robinhood],
  connectors: [injected()],
  transports: { [robinhood.id]: http() },
  multiInjectedProviderDiscovery: true,
  ssr: true,
});
