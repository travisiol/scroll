"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { APPS, type AppKey } from "@/config/apps";
import { formatDuration, parseDuration } from "@/core/duration";
import { computeAllocations, type PolicyConfig } from "@/core/policy";
import { formatUnits } from "@/core/units";
import { api, errorMessage } from "@/lib/api";

const CONFIRM = [
  ["week", "The screenshot shows the reporting week this submission is for."],
  ["apps", "Only supported apps are counted."],
  ["durations", "The durations entered match the screenshot."],
  ["overlap", "Overlapping screenshots are counted once, and this isn't a repeat of another week."],
] as const;

export function ReviewPanel({ id, initialUsage, policy, policyVersion }: { id: string; initialUsage: Record<string, number>; policy: PolicyConfig | null; policyVersion: number | null }) {
  const router = useRouter();
  const [text, setText] = useState<Record<string, string>>(() => Object.fromEntries(APPS.map((a) => [a.key, initialUsage[a.key] ? formatDuration(initialUsage[a.key]) : ""])));
  const [saved, setSaved] = useState<Record<string, number>>(initialUsage);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const parsed = useMemo(() => Object.fromEntries(APPS.map((a) => [a.key, text[a.key].trim() === "" ? 0 : parseDuration(text[a.key])])) as Record<AppKey, number | null>, [text]);
  const invalid = APPS.filter((a) => parsed[a.key] === null);
  const dirty = APPS.some((a) => (parsed[a.key] ?? -1) !== (saved[a.key] ?? 0));
  const anySaved = Object.values(saved).some((m) => m > 0);
  const preview = useMemo(() => {
    if (!policy || invalid.length) return null;
    try {
      return computeAllocations(policy, parsed as Record<AppKey, number>);
    } catch {
      return null;
    }
  }, [policy, parsed, invalid.length]);

  async function save() {
    setBusy("save");
    setError(null);
    setNote(null);
    try {
      const { usage } = await api<{ usage: Record<string, number> }>(`/api/admin/submissions/${id}/usage`, { method: "POST", body: { usage: parsed } });
      setSaved(usage);
      setNote("Durations saved.");
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function decide(action: "approve" | "reject" | "request_changes") {
    setBusy(action);
    setError(null);
    setNote(null);
    try {
      await api(`/api/admin/submissions/${id}/decision`, { method: "POST", body: { action, reason } });
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  const allConfirmed = CONFIRM.every(([key]) => checks[key]);
  const reasonOk = reason.trim().length >= 3;

  return (
    <div className="grid gap-5">
      <section aria-labelledby="durations" className="card card-pad">
        <h2 id="durations" className="text-xl tracking-[-0.02em]">
          Verified durations
        </h2>
        <p className="hint mt-1">Enter what the screenshots show for the whole week, e.g. “9h 42m”, “9:42” or “582”. One value per app, however many screenshots show it.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {APPS.map((a) => (
            <div key={a.key}>
              <label className="label" htmlFor={`d-${a.key}`}>
                {a.name} <span className="num font-normal text-muted">→ {a.ticker}</span>
              </label>
              <input
                id={`d-${a.key}`}
                className="field"
                inputMode="text"
                autoComplete="off"
                placeholder="0m"
                value={text[a.key]}
                aria-invalid={parsed[a.key] === null}
                aria-describedby={`h-${a.key}`}
                onChange={(e) => setText((t) => ({ ...t, [a.key]: e.target.value }))}
              />
              <p id={`h-${a.key}`} className={`hint mt-1 ${parsed[a.key] === null ? "!text-bad" : ""}`}>
                {parsed[a.key] === null ? "Not a duration." : `${parsed[a.key]} minutes`}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-dark" disabled={busy !== null || invalid.length > 0 || !dirty} onClick={save}>
            {busy === "save" ? "Saving…" : "Save durations"}
          </button>
          {dirty && <span className="hint">Unsaved changes.</span>}
          {note && (
            <span role="status" className="hint">
              {note}
            </span>
          )}
        </div>
      </section>

      <section aria-labelledby="alloc" className="card card-pad">
        <h2 id="alloc" className="text-xl tracking-[-0.02em]">
          What approval would allocate
        </h2>
        {!policy ? (
          <p className="notice mt-3">No reward policy was published when this was submitted. Approving records the verified usage but allocates nothing.</p>
        ) : preview && preview.length ? (
          <>
            <p className="hint mt-1">Under policy version {policyVersion}, the one this submission was made under. Pool reservation is checked at the moment of approval.</p>
            <ul className="mt-3 grid gap-2">
              {preview.map((l) => (
                <li key={l.ticker} className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    <span className="num font-medium">{l.ticker}</span> <span className="text-muted">· {formatDuration(l.eligibleMinutes)} eligible</span>
                    {l.cappedByWallet && <span className="pill pill-action ml-2">Wallet cap applied</span>}
                  </span>
                  <span className="num">{formatUnits(l.amount, policy.network.tokens[l.ticker].decimals)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-3 text-muted">Nothing, with the durations entered.</p>
        )}
      </section>

      <section aria-labelledby="decision" className="card card-pad">
        <h2 id="decision" className="text-xl tracking-[-0.02em]">
          Decision
        </h2>
        <fieldset className="mt-3 grid gap-2">
          <legend className="hint mb-1">Confirm before approving:</legend>
          {CONFIRM.map(([key, label]) => (
            <label key={key} className="flex items-start gap-2.5">
              <input type="checkbox" className="mt-1 size-4 accent-[#FF2E86]" checked={Boolean(checks[key])} onChange={(e) => setChecks((c) => ({ ...c, [key]: e.target.checked }))} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <label className="label mt-5" htmlFor="reason">
          Explanation for the user
        </label>
        <textarea id="reason" className="field min-h-24" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} placeholder="Required to reject or request changes. Shown to the user as written." />
        <div className="mt-4 flex flex-wrap gap-2.5">
          <button type="button" className="btn btn-primary" disabled={busy !== null || dirty || !anySaved || !allConfirmed} onClick={() => decide("approve")}>
            {busy === "approve" ? "Approving…" : "Approve"}
          </button>
          <button type="button" className="btn btn-quiet" disabled={busy !== null || !reasonOk} onClick={() => decide("request_changes")}>
            Request changes
          </button>
          <button type="button" className="btn btn-danger" disabled={busy !== null || !reasonOk} onClick={() => decide("reject")}>
            Reject
          </button>
        </div>
        <p className="hint mt-3">Approve needs saved durations and all four confirmations. Reject and Request changes need an explanation. Approval allocates; it does not pay.</p>
        {error && (
          <p role="alert" className="notice notice-bad mt-4">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
