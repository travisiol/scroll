// Re-check the token configuration against Robinhood's asset list and the chain: npm run verify:tokens
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/config/network.ts", import.meta.url), "utf8");
const configured = [...source.matchAll(/ticker: "(\w+)".*?address: "(0x[0-9a-fA-F]{40})", decimals: (\d+)/g)].map((m) => ({ ticker: m[1], address: m[2], decimals: Number(m[3]) }));
const rpc = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const call = async (method, params) => (await (await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;

const chainId = parseInt(await call("eth_chainId", []), 16);
console.log(`chain id: ${chainId} ${chainId === 4663 ? "OK" : "MISMATCH (expected 4663)"}`);
const list = (await (await fetch("https://api.robinhood.com/rhj/assets", { headers: { "user-agent": "Mozilla/5.0" } })).json()).assets;
let failed = chainId !== 4663;
for (const t of configured) {
  const listed = list.find((a) => a.tokenSymbol === t.ticker);
  const listedAddress = listed?.deployments.find((d) => d.chainId === 4663)?.contractAddress;
  const symbolHex = await call("eth_call", [{ to: t.address, data: "0x95d89b41" }, "latest"]);
  const symbol = Buffer.from(symbolHex.slice(130), "hex").toString().replace(/\0/g, "");
  const decimals = parseInt(await call("eth_call", [{ to: t.address, data: "0x313ce567" }, "latest"]), 16);
  const ok = listedAddress?.toLowerCase() === t.address.toLowerCase() && listed.status === "ASSET_STATUS_ACTIVE" && symbol === t.ticker && decimals === t.decimals;
  failed ||= !ok;
  console.log(`${t.ticker.padEnd(5)} ${t.address} list:${listedAddress ? listed.status : "NOT LISTED"} chain:${symbol}/${decimals} ${ok ? "OK" : "MISMATCH"}`);
}
process.exit(failed ? 1 : 0);
