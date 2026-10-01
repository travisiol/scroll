"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";

const SUMMARIES = {
  payouts: (r: Record<string, unknown>) => (r.ran ? `Processed ${r.processed}: ${r.submitted} sent, ${r.confirmed} confirmed, ${r.failed} failed, ${r.waiting} waiting.` : `Did not run. ${r.reason}`),
  reservations: (r: Record<string, unknown>) => `${r.reserved} reserved, ${r.stillWaiting} still waiting.`,
  retention: (r: Record<string, unknown>) => `${r.deleted} file(s) deleted.`,
};

/** POST to an admin endpoint, then re-render the page from the server. Optionally asks first. */
export function ActionButton({
  path,
  body = {},
  children,
  className = "btn btn-quiet btn-sm",
  confirm,
  describe,
}: {
  path: string;
  body?: Record<string, unknown>;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
  /** Which summary line to show after success. A key, not a function: this is called from server components. */
  describe?: keyof typeof SUMMARIES;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await api<Record<string, unknown>>(path, { method: "POST", body });
      if (describe) setDone(SUMMARIES[describe](result));
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setAsking(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-2">
      {asking ? (
        <span className="notice inline-flex flex-wrap items-center gap-2">
          <span>{confirm}</span>
          <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={run}>
            {busy ? "Working…" : "Confirm"}
          </button>
          <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => setAsking(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <button type="button" className={className} disabled={busy} onClick={() => (confirm ? setAsking(true) : run())}>
          {busy ? "Working…" : children}
        </button>
      )}
      {done && (
        <span role="status" className="hint">
          {done}
        </span>
      )}
      {error && (
        <span role="alert" className="notice notice-bad">
          {error}
        </span>
      )}
    </span>
  );
}
