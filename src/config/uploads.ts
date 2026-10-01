/** Upload limits and the screenshot retention policy. Shared by the UI and the server. */

function intFromEnv(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export const UPLOADS = {
  maxBytes: intFromEnv(process.env.NEXT_PUBLIC_UPLOAD_MAX_BYTES, 8 * 1024 * 1024),
  /** Smaller than this and durations are rarely readable. */
  minWidth: intFromEnv(process.env.NEXT_PUBLIC_UPLOAD_MIN_WIDTH, 320),
  minHeight: intFromEnv(process.env.NEXT_PUBLIC_UPLOAD_MIN_HEIGHT, 480),
  maxWidth: intFromEnv(process.env.NEXT_PUBLIC_UPLOAD_MAX_DIMENSION, 6000),
  maxHeight: intFromEnv(process.env.NEXT_PUBLIC_UPLOAD_MAX_DIMENSION, 12000),
  /** One main screenshot plus supplementary ones. */
  maxFilesPerSubmission: intFromEnv(process.env.NEXT_PUBLIC_UPLOAD_MAX_FILES, 4),
  /** How many completed weeks back a report can be submitted for. */
  weeksBack: intFromEnv(process.env.NEXT_PUBLIC_WEEKS_BACK, 4),
  /**
   * Screenshot files are deleted this many days after a final decision.
   * The reviewed durations and the file fingerprint stay as the record.
   */
  retentionDays: intFromEnv(process.env.NEXT_PUBLIC_EVIDENCE_RETENTION_DAYS, 90),
} as const;

export const ACCEPTED_MIME = {
  "image/png": { ext: "png", label: "PNG" },
  "image/jpeg": { ext: "jpg", label: "JPEG" },
  "image/webp": { ext: "webp", label: "WebP" },
} as const;
export type AcceptedMime = keyof typeof ACCEPTED_MIME;

export const ACCEPT_ATTRIBUTE = Object.keys(ACCEPTED_MIME).join(",");

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
