/**
 * Supported apps and the stock token each one maps to.
 * Instagram and Facebook both map to META and are added together into one
 * META allocation. The listed companies are not partners or sponsors.
 */

export const TICKERS = ["META", "SNAP", "RDDT", "NFLX", "RBLX"] as const;
export type Ticker = (typeof TICKERS)[number];

export interface SupportedApp {
  key: string;
  name: string;
  ticker: Ticker;
}

export const APPS = [
  { key: "instagram", name: "Instagram", ticker: "META" },
  { key: "facebook", name: "Facebook", ticker: "META" },
  { key: "snapchat", name: "Snapchat", ticker: "SNAP" },
  { key: "reddit", name: "Reddit", ticker: "RDDT" },
  { key: "netflix", name: "Netflix", ticker: "NFLX" },
  { key: "roblox", name: "Roblox", ticker: "RBLX" },
] as const satisfies readonly SupportedApp[];

export type AppKey = (typeof APPS)[number]["key"];

export const APP_KEYS = APPS.map((a) => a.key) as AppKey[];

export function appByKey(key: string): SupportedApp | undefined {
  return APPS.find((a) => a.key === key);
}

export function isTicker(value: string): value is Ticker {
  return (TICKERS as readonly string[]).includes(value);
}

export function appsForTicker(ticker: Ticker): SupportedApp[] {
  return APPS.filter((a) => a.ticker === ticker);
}

export const PLATFORMS = {
  ios: { key: "ios", name: "iOS Screen Time" },
  android: { key: "android", name: "Android Digital Wellbeing" },
} as const;
export type Platform = keyof typeof PLATFORMS;
