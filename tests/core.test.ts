import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDuration, parseDuration } from "@/core/duration";
import { sniffImage } from "@/core/image";
import { PolicyError, computeAllocations, validatePolicy, type PolicyConfig } from "@/core/policy";
import { formatUnits, parseUnits } from "@/core/units";
import { completedWeeks, formatWeek, isSelectableWeek, weekStartOf } from "@/core/weeks";
import { fakePng } from "./setup";

const token = { address: "0x0000000000000000000000000000000000000001", decimals: 18 };
const policy: PolicyConfig = {
  label: "test",
  tickers: {
    META: { enabled: true, unitsPerMinute: "1000", walletWeeklyCap: "900000", weeklyPoolLimit: "10000000", minPayout: "0" },
    SNAP: { enabled: true, unitsPerMinute: "7", walletWeeklyCap: "1000000", weeklyPoolLimit: "10000000", minPayout: "0" },
    RDDT: { enabled: true, unitsPerMinute: "3", walletWeeklyCap: "1000000", weeklyPoolLimit: "10000000", minPayout: "0" },
    NFLX: { enabled: false, unitsPerMinute: "5", walletWeeklyCap: "1000000", weeklyPoolLimit: "10000000", minPayout: "0" },
    RBLX: { enabled: true, unitsPerMinute: "5", walletWeeklyCap: "1000000", weeklyPoolLimit: "10000000", minPayout: "0" },
  },
  apps: {
    instagram: { maxMinutesPerWeek: 600 },
    facebook: { maxMinutesPerWeek: 600 },
    snapchat: { maxMinutesPerWeek: 600 },
    reddit: { maxMinutesPerWeek: 600 },
    netflix: { maxMinutesPerWeek: 600 },
    roblox: { maxMinutesPerWeek: 600 },
  },
  network: { chainId: 4663, tokens: { META: token, SNAP: token, RDDT: token, NFLX: token, RBLX: token } },
};

test("durations: the formats a reviewer reads off a screenshot", () => {
  assert.equal(parseDuration("9h 42m"), 582);
  assert.equal(parseDuration("9 h 42 min"), 582);
  assert.equal(parseDuration("9:42"), 582);
  assert.equal(parseDuration("4h"), 240);
  assert.equal(parseDuration("45m"), 45);
  assert.equal(parseDuration("582"), 582);
  assert.equal(parseDuration(" 6H 05M "), 365);
  assert.equal(parseDuration("0m"), 0);
});

test("durations: refuses what isn't one", () => {
  for (const bad of ["", "abc", "9h 75m", "-5", "1.5h", "9h42", "200h", "9:75", "h", "10081"]) {
    assert.equal(parseDuration(bad), null, bad);
  }
});

test("durations: formatting round-trips", () => {
  assert.equal(formatDuration(582), "9h 42m");
  assert.equal(formatDuration(365), "6h 05m");
  assert.equal(formatDuration(45), "45m");
  for (const m of [0, 1, 59, 60, 61, 1197, 10080]) assert.equal(parseDuration(formatDuration(m)), m);
});

test("units: exact decimal strings, never floats", () => {
  assert.equal(formatUnits("4000000000000000", 18), "0.004");
  assert.equal(formatUnits("1000000000000000000", 18), "1");
  assert.equal(formatUnits("1", 18), "0.000000000000000001");
  assert.equal(formatUnits("0", 18), "0");
  assert.equal(parseUnits("0.004", 18), BigInt("4000000000000000"));
  assert.equal(parseUnits("12", 6), BigInt(12000000));
  // 0.1 + 0.2 is exactly 0.3 here.
  assert.equal(formatUnits(parseUnits("0.1", 18)! + parseUnits("0.2", 18)!, 18), "0.3");
  // More precision than the token has is refused, not rounded.
  assert.equal(parseUnits("0.0000001", 6), null);
  for (const bad of ["", "-1", "1e5", "1,5", ".5", "abc"]) assert.equal(parseUnits(bad, 18), null, bad);
});

test("policy: Instagram and Facebook become one META allocation", () => {
  const lines = computeAllocations(policy, { instagram: 300, facebook: 120, reddit: 10 });
  assert.equal(lines.length, 2);
  const meta = lines.find((l) => l.ticker === "META")!;
  assert.equal(meta.eligibleMinutes, 420);
  assert.equal(meta.amount, BigInt(420_000));
  assert.equal(meta.apps.length, 2);
  assert.equal(lines.find((l) => l.ticker === "RDDT")!.amount, BigInt(30));
});

test("policy: per-app minute limit, then per-wallet cap", () => {
  // 700 verified minutes on each app count as 600 + 600; 1,200,000 units is capped to 900,000.
  const [meta] = computeAllocations(policy, { instagram: 700, facebook: 700 });
  assert.equal(meta.eligibleMinutes, 1200);
  assert.equal(meta.uncapped, BigInt(1_200_000));
  assert.equal(meta.amount, BigInt(900_000));
  assert.equal(meta.cappedByWallet, true);
});

test("policy: disabled tickers and zero usage produce nothing", () => {
  assert.deepEqual(computeAllocations(policy, { netflix: 500 }), []);
  assert.deepEqual(computeAllocations(policy, {}), []);
  assert.throws(() => computeAllocations(policy, { reddit: 1.5 }));
});

test("policy: amounts beyond 2^53 stay exact", () => {
  const big = structuredClone(policy);
  big.tickers.SNAP.unitsPerMinute = "123456789012345678901";
  big.tickers.SNAP.walletWeeklyCap = "9".repeat(40);
  const [snap] = computeAllocations(big, { snapchat: 599 });
  assert.equal(snap.amount.toString(), (BigInt("123456789012345678901") * BigInt(599)).toString());
});

test("policy: validation reports every problem and rejects floats", () => {
  assert.equal(validatePolicy(structuredClone(policy)).tickers.META.unitsPerMinute, "1000");
  const bad = structuredClone(policy) as unknown as Record<string, Record<string, Record<string, unknown>>>;
  bad.tickers.META.unitsPerMinute = 0.5;
  bad.apps.reddit.maxMinutesPerWeek = -1;
  assert.throws(() => validatePolicy(bad), (e: unknown) => e instanceof PolicyError && e.issues.length >= 2);
  const zero = structuredClone(policy);
  zero.tickers.META.unitsPerMinute = "0";
  assert.throws(() => validatePolicy(zero), PolicyError);
});

test("images: identified by content, with dimensions", () => {
  assert.deepEqual(sniffImage(fakePng(1170, 2532, 1)), { mime: "image/png", width: 1170, height: 2532 });
  // JPEG: SOI, APP0 (16 bytes), SOF0 with 800x600.
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, 0x02, 0x58, 0x03, 0x20, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(sniffImage(jpeg), { mime: "image/jpeg", width: 800, height: 600 });
  // WebP, VP8X header, 1080x1920.
  const webp = new Uint8Array(40);
  webp.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
  webp.set([..."WEBPVP8X"].map((c) => c.charCodeAt(0)), 8);
  webp.set([0x37, 0x04, 0x00, 0x7f, 0x07, 0x00], 24);
  assert.deepEqual(sniffImage(webp), { mime: "image/webp", width: 1080, height: 1920 });
});

test("images: a renamed non-image is refused", () => {
  assert.equal(sniffImage(new TextEncoder().encode("<html><script>alert(1)</script></html>".padEnd(64))), null);
  assert.equal(sniffImage(new TextEncoder().encode("%PDF-1.7".padEnd(64))), null);
  assert.equal(sniffImage(new Uint8Array(0)), null);
});

test("weeks: only completed weeks can be reported", () => {
  const thursday = new Date("2026-10-01T15:00:00Z");
  assert.equal(weekStartOf(thursday, 0), "2026-09-27");
  assert.deepEqual(completedWeeks(thursday, 3, 0), ["2026-09-20", "2026-09-13", "2026-09-06"]);
  assert.equal(isSelectableWeek("2026-09-20", thursday, 4, 0), true);
  assert.equal(isSelectableWeek("2026-09-27", thursday, 4, 0), false, "current week is still running");
  assert.equal(isSelectableWeek("2026-09-21", thursday, 4, 0), false, "not a week start");
  assert.equal(isSelectableWeek("2026-08-23", thursday, 4, 0), false, "too old");
  assert.equal(weekStartOf(thursday, 1), "2026-09-28");
  assert.equal(formatWeek("2026-09-20"), "Sep 20 – Sep 26, 2026");
});
