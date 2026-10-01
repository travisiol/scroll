/**
 * Token amounts are integers in base units (bigint). They are stored as
 * NUMERIC(78,0) and cross JSON as decimal strings. No floating point.
 */

export function isBaseUnits(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,78}$/.test(value);
}

export function toBig(value: string | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (!isBaseUnits(value)) throw new Error("Not a base-unit amount");
  return BigInt(value);
}

/** 4000000000000000n, 18 → "0.004". Exact; trailing zeros trimmed. */
export function formatUnits(value: string | bigint, decimals: number): string {
  const v = toBig(value);
  if (decimals === 0) return v.toString();
  const padded = v.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/** "0.004", 18 → 4000000000000000n. Returns null rather than rounding. */
export function parseUnits(input: string, decimals: number): bigint | null {
  const text = input.trim();
  const match = /^(\d{1,60})(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  return BigInt(match[1] + fraction.padEnd(decimals, "0"));
}

export function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
