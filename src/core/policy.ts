/**
 * The reward policy: a versioned configuration document plus the one
 * function that turns verified minutes into token amounts. Pure code,
 * bigint arithmetic only.
 */
import { APPS, APP_KEYS, TICKERS, type AppKey, type Ticker } from "@/config/apps";
import { MAX_WEEK_MINUTES } from "./duration";
import { isBaseUnits, minBig, toBig } from "./units";

export interface TickerPolicy {
  enabled: boolean;
  /** Token base units earned per eligible minute. */
  unitsPerMinute: string;
  /** Most base units one wallet can be allocated for one reporting week. */
  walletWeeklyCap: string;
  /** Most base units that can be reserved for this token for one reporting week. */
  weeklyPoolLimit: string;
  /** Allocations are held until the wallet's unpaid total reaches this. */
  minPayout: string;
}

export interface PolicyConfig {
  label: string;
  tickers: Record<Ticker, TickerPolicy>;
  apps: Record<AppKey, { maxMinutesPerWeek: number }>;
  /** Token and network configuration, captured when the policy is written. */
  network: { chainId: number; tokens: Record<Ticker, { address: string; decimals: number }> };
}

export class PolicyError extends Error {
  issues: string[];
  constructor(issues: string[]) {
    super(issues.join(" "));
    this.name = "PolicyError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate untrusted input into a PolicyConfig, or throw every problem found. */
export function validatePolicy(input: unknown): PolicyConfig {
  const issues: string[] = [];
  if (!isRecord(input)) throw new PolicyError(["Policy must be an object."]);

  const label = typeof input.label === "string" ? input.label.trim().slice(0, 120) : "";
  if (!label) issues.push("Give the policy a label.");

  const tickersIn = isRecord(input.tickers) ? input.tickers : {};
  const tickers = {} as Record<Ticker, TickerPolicy>;
  for (const ticker of TICKERS) {
    const t = isRecord(tickersIn[ticker]) ? (tickersIn[ticker] as Record<string, unknown>) : {};
    const enabled = t.enabled === true;
    const fields = ["unitsPerMinute", "walletWeeklyCap", "weeklyPoolLimit", "minPayout"] as const;
    const out = { enabled } as TickerPolicy;
    for (const field of fields) {
      const value = t[field];
      if (!isBaseUnits(value)) {
        issues.push(`${ticker}: ${field} must be a whole number of base units.`);
        out[field] = "0";
      } else {
        out[field] = BigInt(value).toString();
      }
    }
    if (enabled) {
      if (out.unitsPerMinute === "0") issues.push(`${ticker}: unitsPerMinute must be above zero when enabled.`);
      if (out.walletWeeklyCap === "0") issues.push(`${ticker}: walletWeeklyCap must be above zero when enabled.`);
      if (out.weeklyPoolLimit === "0") issues.push(`${ticker}: weeklyPoolLimit must be above zero when enabled.`);
    }
    tickers[ticker] = out;
  }

  const appsIn = isRecord(input.apps) ? input.apps : {};
  const apps = {} as Record<AppKey, { maxMinutesPerWeek: number }>;
  for (const key of APP_KEYS) {
    const a = isRecord(appsIn[key]) ? (appsIn[key] as Record<string, unknown>) : {};
    const max = a.maxMinutesPerWeek;
    if (typeof max !== "number" || !Number.isInteger(max) || max < 0 || max > MAX_WEEK_MINUTES) {
      issues.push(`${key}: maxMinutesPerWeek must be a whole number of minutes between 0 and ${MAX_WEEK_MINUTES}.`);
      apps[key] = { maxMinutesPerWeek: 0 };
    } else {
      apps[key] = { maxMinutesPerWeek: max };
    }
  }

  const netIn = isRecord(input.network) ? input.network : {};
  const tokensIn = isRecord(netIn.tokens) ? netIn.tokens : {};
  const tokens = {} as Record<Ticker, { address: string; decimals: number }>;
  if (typeof netIn.chainId !== "number" || !Number.isInteger(netIn.chainId) || netIn.chainId <= 0) {
    issues.push("network.chainId is missing.");
  }
  for (const ticker of TICKERS) {
    const t = isRecord(tokensIn[ticker]) ? (tokensIn[ticker] as Record<string, unknown>) : {};
    const address = typeof t.address === "string" && /^0x[0-9a-fA-F]{40}$/.test(t.address) ? t.address : "";
    const decimals = typeof t.decimals === "number" && Number.isInteger(t.decimals) && t.decimals >= 0 && t.decimals <= 36 ? t.decimals : -1;
    if (!address || decimals < 0) issues.push(`${ticker}: token address or decimals missing from network config.`);
    tokens[ticker] = { address, decimals: Math.max(decimals, 0) };
  }

  if (issues.length) throw new PolicyError(issues);
  return { label, tickers, apps, network: { chainId: netIn.chainId as number, tokens } };
}

export interface AllocationLine {
  ticker: Ticker;
  /** Minutes counted after each app's weekly limit. */
  eligibleMinutes: number;
  /** eligibleMinutes × unitsPerMinute, before the wallet cap. */
  uncapped: bigint;
  /** What is actually allocated. */
  amount: bigint;
  cappedByWallet: boolean;
  apps: { app: AppKey; verifiedMinutes: number; eligibleMinutes: number }[];
}

/**
 * Verified minutes per app → one allocation line per ticker.
 * Instagram and Facebook land in the same META line. Tickers that are
 * disabled or come out at zero are omitted.
 */
export function computeAllocations(policy: PolicyConfig, usage: Partial<Record<AppKey, number>>): AllocationLine[] {
  const lines: AllocationLine[] = [];
  for (const ticker of TICKERS) {
    const rule = policy.tickers[ticker];
    if (!rule?.enabled) continue;
    const apps: AllocationLine["apps"] = [];
    let eligible = 0;
    for (const app of APPS) {
      if (app.ticker !== ticker) continue;
      const verified = usage[app.key] ?? 0;
      if (!Number.isInteger(verified) || verified < 0) throw new Error(`Invalid minutes for ${app.key}`);
      if (verified === 0) continue;
      const counted = Math.min(verified, policy.apps[app.key].maxMinutesPerWeek);
      apps.push({ app: app.key, verifiedMinutes: verified, eligibleMinutes: counted });
      eligible += counted;
    }
    if (eligible === 0) continue;
    const uncapped = BigInt(eligible) * toBig(rule.unitsPerMinute);
    const amount = minBig(uncapped, toBig(rule.walletWeeklyCap));
    if (amount === BigInt(0)) continue;
    lines.push({ ticker, eligibleMinutes: eligible, uncapped, amount, cappedByWallet: amount < uncapped, apps });
  }
  return lines;
}
