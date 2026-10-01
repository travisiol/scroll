import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { rewardAllocations, submissions, verifiedUsage } from "@/db/schema";
import { TICKERS, type Ticker } from "@/config/apps";
import { TOKENS } from "@/config/network";
import { allocationViews, type AllocationView } from "./submissions";

export interface TickerTotals {
  ticker: Ticker;
  decimals: number;
  /** Everything allocated to this wallet, in any payout state. */
  allocated: bigint;
  /** Only transfers confirmed on the network. */
  paid: bigint;
  history: AllocationView[];
}

/** Per-token totals. Tokens are never added to each other. */
export async function rewardTotals(userId: string): Promise<TickerTotals[]> {
  const all = await allocationViews(eq(rewardAllocations.userId, userId));
  return TICKERS.map((ticker) => {
    const history = all.filter((a) => a.ticker === ticker);
    const sum = (rows: AllocationView[]) => rows.reduce((s, a) => s + BigInt(a.amount), BigInt(0));
    return { ticker, decimals: history[0]?.decimals ?? TOKENS[ticker].decimals, allocated: sum(history), paid: sum(history.filter((a) => a.state === "confirmed")), history };
  });
}

/** Verified minutes per app across this wallet's approved submissions. */
export async function approvedUsage(userId: string): Promise<{ app: string; minutes: number }[]> {
  const db = await getDb();
  return db
    .select({ app: verifiedUsage.app, minutes: sql<number>`sum(${verifiedUsage.minutes})::int` })
    .from(verifiedUsage)
    .innerJoin(submissions, eq(submissions.id, verifiedUsage.submissionId))
    .where(and(eq(submissions.userId, userId), eq(submissions.status, "approved")))
    .groupBy(verifiedUsage.app);
}
