"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { APPS, TICKERS, type AppKey, type Ticker } from "@/config/apps";
import { parseDuration, formatDuration } from "@/core/duration";
import type { PolicyConfig } from "@/core/policy";
import { formatUnits, parseUnits } from "@/core/units";
import { api, errorMessage } from "@/lib/api";

const FIELDS = [
  ["unitsPerMinute", "Per eligible minute"],
  ["walletWeeklyCap", "Cap per wallet per week"],
  ["weeklyPoolLimit", "Weekly pool limit"],
  ["minPayout", "Minimum payout"],
] as const;
type Field = (typeof FIELDS)[number][0];

/**
 * Amounts are typed as token quantities ("0.000004") and converted to base
 * units with exact decimal parsing. Nothing is pre-filled with a suggested
 * rate: the numbers are a decision, not a default.
 */
export function PolicyEditor({ draftId, initial }: { draftId: string | null; initial: PolicyConfig }) {
  const router = useRouter();
  const [label, setLabel] = useState(initial.label);
  const [enabled, setEnabled] = useState<Record<Ticker, boolean>>(() => Object.fromEntries(TICKERS.map((t) => [t, initial.tickers[t].enabled])) as Record<Ticker, boolean>);
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(TICKERS.flatMap((t) => FIELDS.map(([f]) => [`${t}.${f}`, initial.tickers[t][f] === "0" ? "" : formatUnits(initial.tickers[t][f], initial.network.tokens[t].decimals)]))),
  );
  const [limits, setLimits] = useState<Record<string, string>>(() => Object.fromEntries(APPS.map((a) => [a.key, initial.apps[a.key].maxMinutesPerWeek ? formatDuration(initial.apps[a.key].maxMinutesPerWeek) : ""])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function build(): PolicyConfig | string {
    const tickers = {} as PolicyConfig["tickers"];
    for (const t of TICKERS) {
      const d = initial.network.tokens[t].decimals;
      const out = { enabled: enabled[t] } as PolicyConfig["tickers"][Ticker];
      for (const [f, name] of FIELDS) {
        const raw = amounts[`${t}.${f}`].trim();
        const units = raw === "" ? BigInt(0) : parseUnits(raw, d);
        if (units === null) return `${t} · ${name}: “${raw}” isn't a valid amount (up to ${d} decimals).`;
        out[f as Field] = units.toString();
      }
      tickers[t] = out;
    }
    const apps = {} as PolicyConfig["apps"];
    for (const a of APPS) {
      const raw = limits[a.key].trim();
      const minutes = raw === "" ? 0 : parseDuration(raw);
      if (minutes === null) return `${a.name}: “${raw}” isn't a duration.`;
      apps[a.key as AppKey] = { maxMinutesPerWeek: minutes };
    }
    return { label, tickers, apps, network: initial.network };
  }

  async function save() {
    setSaved(false);
    const config = build();
    if (typeof config === "string") return setError(config);
    setBusy(true);
    setError(null);
    try {
      await api(draftId ? `/api/admin/policy/${draftId}` : "/api/admin/policy", { method: "POST", body: { config } });
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className="label" htmlFor="label">
        Label
      </label>
      <input id="label" className="field max-w-md" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Launch policy" />

      <div className="mt-6 overflow-x-auto">
        <table className="table min-w-[52rem]">
          <caption className="sr-only">Per-token rules, in token units</caption>
          <thead>
            <tr>
              <th scope="col">Token</th>
              <th scope="col">Enabled</th>
              {FIELDS.map(([f, name]) => (
                <th key={f} scope="col">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TICKERS.map((t) => (
              <tr key={t}>
                <th scope="row" className="num font-medium">
                  {t}
                </th>
                <td>
                  <input type="checkbox" className="size-5 accent-[#FF2E86]" aria-label={`Enable ${t}`} checked={enabled[t]} onChange={(e) => setEnabled((v) => ({ ...v, [t]: e.target.checked }))} />
                </td>
                {FIELDS.map(([f, name]) => (
                  <td key={f}>
                    <input
                      className="field num min-h-10 py-1.5"
                      inputMode="decimal"
                      autoComplete="off"
                      aria-label={`${t} ${name}`}
                      placeholder="0"
                      value={amounts[`${t}.${f}`]}
                      onChange={(e) => setAmounts((v) => ({ ...v, [`${t}.${f}`]: e.target.value }))}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint mt-2">Amounts are in whole tokens (18 decimals) and stored as integer base units. Leave a field empty for zero.</p>

      <h3 className="mt-7 text-lg tracking-[-0.02em]">Eligible time per app, per week</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {APPS.map((a) => (
          <div key={a.key}>
            <label className="label" htmlFor={`l-${a.key}`}>
              {a.name} <span className="num font-normal text-muted">→ {a.ticker}</span>
            </label>
            <input id={`l-${a.key}`} className="field" autoComplete="off" placeholder="e.g. 20h" value={limits[a.key]} onChange={(e) => setLimits((v) => ({ ...v, [a.key]: e.target.value }))} />
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-dark" disabled={busy} onClick={save}>
          {busy ? "Saving…" : draftId ? "Save draft" : "Create draft"}
        </button>
        {saved && (
          <span role="status" className="hint">
            Draft saved.
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="notice notice-bad mt-4">
          {error}
        </p>
      )}
    </div>
  );
}
