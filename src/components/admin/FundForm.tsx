"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TICKERS, type Ticker } from "@/config/apps";
import { parseUnits } from "@/core/units";
import { api, errorMessage } from "@/lib/api";

export function FundForm({ decimals }: { decimals: Record<Ticker, number> }) {
  const router = useRouter();
  const [ticker, setTicker] = useState<Ticker>(TICKERS[0]);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setDone(false);
    const units = parseUnits(amount, decimals[ticker]);
    if (units === null || units === BigInt(0)) return setError("Enter an amount above zero, in whole tokens.");
    if (!note.trim()) return setError("Add a note: where this funding came from.");
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/pools/fund", { method: "POST", body: { ticker, amount: units.toString(), note } });
      setAmount("");
      setNote("");
      setDone(true);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[8rem_1fr_1.4fr_auto] sm:items-end">
      <div>
        <label className="label" htmlFor="fund-ticker">
          Token
        </label>
        <select id="fund-ticker" className="field num" value={ticker} onChange={(e) => setTicker(e.target.value as Ticker)}>
          {TICKERS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="fund-amount">
          Amount (tokens)
        </label>
        <input id="fund-amount" className="field num" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" />
      </div>
      <div>
        <label className="label" htmlFor="fund-note">
          Source / reference
        </label>
        <input id="fund-note" className="field" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. treasury deposit, tx 0x…" />
      </div>
      <button type="submit" className="btn btn-dark" disabled={busy}>
        {busy ? "Recording…" : "Record funding"}
      </button>
      {done && (
        <p role="status" className="hint sm:col-span-4">
          Recorded. Waiting allocations were re-checked.
        </p>
      )}
      {error && (
        <p role="alert" className="notice notice-bad sm:col-span-4">
          {error}
        </p>
      )}
    </form>
  );
}
