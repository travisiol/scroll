"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { APPS, PLATFORMS, type Platform } from "@/config/apps";
import { ACCEPTED_MIME, ACCEPT_ATTRIBUTE, UPLOADS, formatBytes } from "@/config/uploads";
import { ApiError, api, errorMessage } from "@/lib/api";

interface EvidenceItem {
  id: string;
  kind: string;
  bytes: number;
  width: number;
  height: number;
  url: string;
}

export interface UploadInitial {
  id: string;
  platform: Platform;
  weekStart: string;
  weekLabel: string;
  status: string;
  reviewerNote: string | null;
  evidence: EvidenceItem[];
}

interface WeekOption {
  weekStart: string;
  label: string;
  existing: { id: string; status: string } | null;
}

const STEPS = ["Source", "Week", "How to", "Screenshot", "Confirm"];

const INSTRUCTIONS: Record<Platform, string[]> = {
  ios: [
    "Open Settings, then Screen Time.",
    "Tap “See All App & Website Activity”, then choose Week.",
    "Swipe the chart back to the week you picked. The date range is shown at the top.",
    "Under “Most Used”, tap “Show More” until the supported apps you used are visible.",
    "Take a screenshot that shows the date range and each app's time.",
  ],
  android: [
    "Open Settings, then “Digital Wellbeing & parental controls”.",
    "Tap the chart to open the dashboard, then switch to the weekly view.",
    "Go back to the week you picked. The dates are shown above the chart.",
    "Scroll until the supported apps you used are visible with their weekly times.",
    "Take a screenshot that shows the dates and each app's time. Menus vary by phone maker; what matters is a weekly total per app and the week's dates.",
  ],
};

const CHECKS = [
  ["apps", "App names are readable."],
  ["durations", "Each app's usage time is readable."],
  ["period", "The reporting week's dates are visible and match the week I picked."],
  ["private", "I cropped out anything private that isn't needed."],
] as const;

function uploadFile(submissionId: string, file: File, onProgress: (fraction: number) => void): Promise<{ evidence: EvidenceItem; duplicate: boolean }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/submissions/${submissionId}/evidence`);
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError(0, "The upload didn't go through. Check your connection and try again."));
    xhr.onload = () => {
      let data: { error?: string; code?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* handled below */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as { evidence: EvidenceItem; duplicate: boolean });
      else reject(new ApiError(xhr.status, data.error ?? "The upload failed.", data.code));
    };
    xhr.send(file);
  });
}

export function UploadFlow({ weeks, initial, policyPublished }: { weeks: WeekOption[]; initial: UploadInitial | null; policyPublished: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(initial ? 3 : 0);
  const [platform, setPlatform] = useState<Platform | null>(initial?.platform ?? null);
  const [weekStart, setWeekStart] = useState<string | null>(initial?.weekStart ?? null);
  const [submissionId, setSubmissionId] = useState<string | null>(initial?.id ?? null);
  const [files, setFiles] = useState<EvidenceItem[]>(initial?.evidence ?? []);
  const [progress, setProgress] = useState<{ name: string; fraction: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);

  const weekLabel = initial?.weekLabel ?? weeks.find((w) => w.weekStart === weekStart)?.label ?? "";
  const revising = initial?.status === "needs_changes";
  const locked = Boolean(initial);
  const allChecked = CHECKS.every(([key]) => checks[key]);

  function go(next: number) {
    setError(null);
    setStep(next);
  }

  async function ensureDraft(): Promise<boolean> {
    if (!platform || !weekStart) return false;
    setBusy(true);
    setError(null);
    setExisting(null);
    try {
      const { id } = await api<{ id: string }>("/api/submissions", { method: "POST", body: { platform, weekStart } });
      setSubmissionId(id);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code?.startsWith("existing:")) setExisting(e.code.slice("existing:".length));
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addFiles(list: FileList | File[]) {
    if (!submissionId) return;
    setError(null);
    for (const file of Array.from(list)) {
      if (!(file.type in ACCEPTED_MIME)) {
        setError(`“${file.name}” isn't a PNG, JPEG or WebP image.`);
        continue;
      }
      if (file.size > UPLOADS.maxBytes) {
        setError(`“${file.name}” is ${formatBytes(file.size)}. Screenshots can be up to ${formatBytes(UPLOADS.maxBytes)}.`);
        continue;
      }
      setProgress({ name: file.name, fraction: 0 });
      try {
        const { evidence, duplicate } = await uploadFile(submissionId, file, (fraction) => setProgress({ name: file.name, fraction }));
        if (duplicate) setError(`“${file.name}” is already in this submission.`);
        else setFiles((current) => [...current, evidence]);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setProgress(null);
      }
    }
    if (input.current) input.current.value = "";
  }

  async function removeFile(id: string) {
    if (!submissionId) return;
    setError(null);
    try {
      await api(`/api/submissions/${submissionId}/evidence?evidenceId=${id}`, { method: "DELETE" });
      setFiles((current) => {
        const rest = current.filter((f) => f.id !== id);
        return rest.map((f, i) => ({ ...f, kind: i === 0 ? "primary" : "supplementary" }));
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function submit() {
    if (!submissionId) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/submissions/${submissionId}/submit`, { method: "POST", body: { confirmed: allChecked } });
      router.push(`/app/submissions/${submissionId}?submitted=1`);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const full = files.length >= UPLOADS.maxFilesPerSubmission;

  return (
    <div className="mx-auto max-w-3xl">
      <ol aria-label="Progress" className="mb-6 flex gap-1.5">
        {STEPS.map((label, i) => (
          <li key={label} className="flex-1" aria-current={i === step ? "step" : undefined}>
            <span className={`block h-1.5 rounded-full ${i <= step ? "bg-pink" : "bg-line"}`} />
            <span className={`mt-2 block text-xs font-semibold sm:text-sm ${i === step ? "text-ink" : "text-muted"}`}>
              <span className="max-sm:sr-only">{i + 1}. </span>
              {label}
            </span>
          </li>
        ))}
      </ol>

      {revising && initial?.reviewerNote && (
        <div className="notice mb-5">
          <strong className="font-semibold">The reviewer asked for changes:</strong> {initial.reviewerNote}
        </div>
      )}

      <div className="card card-pad">
        {step === 0 && (
          <fieldset>
            <legend className="text-2xl font-extrabold tracking-[-0.025em]">Where is your report from?</legend>
            <div className="mt-5 grid gap-3 sm:grid-cols-2" role="radiogroup">
              {(Object.keys(PLATFORMS) as Platform[]).map((key) => (
                <button key={key} type="button" role="radio" aria-checked={platform === key} className="choice" onClick={() => setPlatform(key)}>
                  <span>
                    <span className="block text-lg font-semibold">{PLATFORMS[key].name}</span>
                    <span className="hint">{key === "ios" ? "iPhone or iPad" : "Android phone or tablet"}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-6 flex justify-end">
              <button type="button" className="btn btn-dark" disabled={!platform} onClick={() => go(1)}>
                Continue
              </button>
            </div>
          </fieldset>
        )}

        {step === 1 && (
          <fieldset>
            <legend className="text-2xl font-extrabold tracking-[-0.025em]">Which week are you reporting?</legend>
            <p className="hint mt-2">Only completed weeks, one submission each.</p>
            <div className="mt-5 grid gap-3" role="radiogroup">
              {weeks.map((w) => {
                const taken = w.existing && w.existing.status !== "draft";
                return (
                  <button
                    key={w.weekStart}
                    type="button"
                    role="radio"
                    aria-checked={weekStart === w.weekStart}
                    aria-disabled={taken ? true : undefined}
                    className="choice items-center justify-between"
                    onClick={() => !taken && setWeekStart(w.weekStart)}
                  >
                    <span className="text-lg font-semibold">{w.label}</span>
                    {w.existing && <span className="hint">{w.existing.status === "draft" ? "Draft started" : "Already submitted"}</span>}
                  </button>
                );
              })}
            </div>
            {weeks.some((w) => w.existing && w.existing.status !== "draft") && (
              <p className="hint mt-3">
                Weeks you already submitted are on your{" "}
                <Link className="link" href="/app">
                  dashboard
                </Link>
                .
              </p>
            )}
            <div className="mt-6 flex justify-between gap-3">
              <button type="button" className="btn btn-quiet" onClick={() => go(0)}>
                Back
              </button>
              <button type="button" className="btn btn-dark" disabled={!weekStart || busy} onClick={async () => {
                  const draft = weeks.find((w) => w.weekStart === weekStart)?.existing;
                  // A draft already holds screenshots: reopen it rather than start over.
                  if (draft?.status === "draft") router.push(`/app/upload?id=${draft.id}`);
                  else if (await ensureDraft()) go(2);
                }}>
                {busy ? "Saving…" : "Continue"}
              </button>
            </div>
          </fieldset>
        )}

        {step === 2 && platform && (
          <div>
            <h2 className="text-2xl tracking-[-0.025em]">How to take the screenshot</h2>
            <p className="hint mt-2">
              {PLATFORMS[platform].name} · {weekLabel}
            </p>
            <ol className="mt-5 grid gap-3">
              {INSTRUCTIONS[platform].map((line, i) => (
                <li key={line} className="flex gap-3 leading-relaxed">
                  <span className="num mt-0.5 text-sm font-medium text-coral">0{i + 1}</span>
                  <span>{line}</span>
                </li>
              ))}
            </ol>
            <p className="notice mt-5">
              <strong className="font-semibold">Crop before you upload.</strong> We only need the date range and these apps: {APPS.map((a) => a.name).join(", ")}. Leave out other apps, notifications, names and anything else private.
            </p>
            <div className="mt-6 flex justify-between gap-3">
              <button type="button" className="btn btn-quiet" disabled={locked} onClick={() => go(1)}>
                Back
              </button>
              <button type="button" className="btn btn-dark" onClick={() => go(3)}>
                I have my screenshot
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="text-2xl tracking-[-0.025em]">Add your screenshot</h2>
            <p className="hint mt-2">
              {weekLabel} · {Object.values(ACCEPTED_MIME).map((m) => m.label).join(", ")} · up to {formatBytes(UPLOADS.maxBytes)} each
            </p>

            <input ref={input} id="file" type="file" accept={ACCEPT_ATTRIBUTE} multiple className="sr-only" onChange={(e) => e.target.files && addFiles(e.target.files)} disabled={full || progress !== null} />
            <label
              htmlFor="file"
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (!full && !progress) addFiles(e.dataTransfer.files);
              }}
              className={`mt-5 grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed px-5 py-10 text-center transition-colors focus-within:outline-3 focus-within:outline-violet ${dragging ? "border-pink bg-[#fff3f7]" : "border-[#e2c9d3] bg-white"} ${full ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <span className="text-lg font-semibold">{full ? "Maximum number of screenshots reached" : files.length ? "Add another screenshot" : "Choose a screenshot"}</span>
              <span className="hint mt-1 max-sm:hidden">or drag and drop it here</span>
            </label>

            {progress && (
              <div className="mt-4" role="status">
                <div className="flex justify-between text-sm">
                  <span className="truncate font-semibold">Uploading {progress.name}</span>
                  <span className="num">{Math.round(progress.fraction * 100)}%</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-pink transition-[width]" style={{ width: `${Math.max(4, progress.fraction * 100)}%` }} />
                </div>
              </div>
            )}

            {files.length > 0 && (
              <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                {files.map((f, i) => (
                  <li key={f.id} className="overflow-hidden rounded-2xl border border-line bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element -- private, signed, short-lived URL */}
                    <img src={f.url} alt={`Screenshot ${i + 1} preview`} className="h-64 w-full bg-blush object-contain" />
                    <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                      <span className="text-sm">
                        <span className="font-semibold">{i === 0 ? "Main screenshot" : "Supplementary"}</span>
                        <span className="hint block">
                          {f.width}×{f.height} · {formatBytes(f.bytes)}
                        </span>
                      </span>
                      <button type="button" className="btn btn-quiet btn-sm" onClick={() => removeFile(f.id)}>
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <p className="hint mt-4">
              If one screenshot can&rsquo;t show every supported app and the dates, add more (up to {UPLOADS.maxFilesPerSubmission}). The reviewer records one time per app for the week, so an app that appears in two screenshots is counted once.
            </p>

            <div className="mt-6 flex justify-between gap-3">
              <button type="button" className="btn btn-quiet" onClick={() => go(2)}>
                Back
              </button>
              <button type="button" className="btn btn-dark" disabled={files.length === 0 || progress !== null} onClick={() => go(4)}>
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <h2 className="text-2xl tracking-[-0.025em]">Check before you submit</h2>
            <p className="hint mt-2">
              {platform ? PLATFORMS[platform].name : ""} · {weekLabel} · {files.length} screenshot{files.length === 1 ? "" : "s"}
            </p>
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {files.map((f, i) => (
                // eslint-disable-next-line @next/next/no-img-element -- private, signed, short-lived URL
                <img key={f.id} src={f.url} alt={`Screenshot ${i + 1}`} className="h-40 w-auto rounded-xl border border-line bg-blush" />
              ))}
            </div>
            <fieldset className="mt-5 grid gap-2.5">
              <legend className="sr-only">Confirm your screenshot is readable</legend>
              {CHECKS.map(([key, label]) => (
                <label key={key} className="choice items-center">
                  <input type="checkbox" className="size-5 accent-[#FF2E86]" checked={Boolean(checks[key])} onChange={(e) => setChecks((c) => ({ ...c, [key]: e.target.checked }))} />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
            <p className="notice mt-5">
              Submitting sends this for manual review. It doesn&rsquo;t create a payout.
              {!policyPublished && " No reward policy is published yet, so this submission can be reviewed but won't be allocated a reward."}
            </p>
            <div className="mt-6 flex justify-between gap-3">
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => go(3)}>
                Back
              </button>
              <button type="button" className="btn btn-primary" disabled={!allChecked || busy} onClick={submit}>
                {busy ? "Submitting…" : revising ? "Resubmit for review" : "Submit for review"}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="notice notice-bad mt-5">
            {error}{" "}
            {existing && (
              <Link className="link" href={`/app/submissions/${existing}`}>
                Open it
              </Link>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
