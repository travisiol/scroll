"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";

/** Delete a draft, or delete the screenshot files of a decided submission. Both ask first. */
export function SubmissionActions({ id, status, hasFiles }: { id: string; status: string; hasFiles: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = status === "draft";
  const decided = status === "approved" || status === "rejected";
  if (!draft && !(decided && hasFiles)) return null;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/submissions/${id}/${draft ? "draft" : "files"}`, { method: "DELETE" });
      if (draft) router.push("/app");
      router.refresh();
      setConfirming(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      {!confirming ? (
        <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirming(true)}>
          {draft ? "Delete draft" : "Delete screenshot files"}
        </button>
      ) : (
        <div className="notice">
          <p>{draft ? "Delete this draft and its screenshots? This can't be undone." : "Delete the screenshot files now? The decision, the verified durations and any rewards stay. This can't be undone."}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={run}>
              {busy ? "Deleting…" : "Yes, delete"}
            </button>
            <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => setConfirming(false)}>
              Keep
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="notice notice-bad mt-3">
          {error}
        </p>
      )}
    </div>
  );
}
