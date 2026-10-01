import "server-only";
import { AppError, isAppError } from "@/core/errors";
import { allowedOrigins } from "./env";

/** Run a handler; turn known errors into JSON and never echo internals. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (isAppError(error)) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    // Log the type and message only; request bodies can contain screenshots.
    console.error("[scroll] request failed:", error instanceof Error ? `${error.name}: ${error.message}` : "unknown");
    return Response.json({ error: "Something went wrong on our side. Nothing was changed." }, { status: 500 });
  }
}

/** Mutations must come from this site's own pages. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  let originHost = "";
  try {
    originHost = origin ? new URL(origin).host : "";
  } catch {
    originHost = "";
  }
  if (!origin || !host || originHost !== host) throw new AppError(403, "Cross-site request refused.");
  const allowed = allowedOrigins();
  if (allowed.length && !allowed.includes(origin)) throw new AppError(403, "Cross-site request refused.");
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    const body = await request.json();
    if (typeof body !== "object" || body === null) throw new Error();
    return body as T;
  } catch {
    throw new AppError(400, "Invalid request body.");
  }
}

/** Read a request body, refusing as soon as it passes `maxBytes`. */
export async function readBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > maxBytes) throw new AppError(413, "That file is too large.");
  if (!request.body) throw new AppError(400, "No file was sent.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AppError(413, "That file is too large.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
