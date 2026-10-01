// End-to-end HTTP checks against the production build, in an isolated data
// folder that is deleted afterwards:
//   npm run build && node scripts/verify-api.mjs
// Wallets are throwaway keys generated for this run. No chain is touched.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

const PORT = Number(process.env.VERIFY_PORT || 3674);
const HOST = `localhost:${PORT}`;
const BASE = `http://${HOST}`;
const DATA = `verify-${Date.now()}`;
const admin = privateKeyToAccount(generatePrivateKey());
const cron = randomBytes(16).toString("hex");

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], {
  env: { ...process.env, SCROLL_DATA_DIR: DATA, ADMIN_WALLETS: admin.address, APP_SECRET: randomBytes(32).toString("hex"), CRON_SECRET: cron, DATABASE_URL: "", TREASURY_PRIVATE_KEY: "", NEXT_PUBLIC_WEEK_STARTS_ON: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  → ${detail}`}`);
}

class Client {
  cookie = "";
  async request(path, { method = "GET", json, bytes, origin = BASE, headers = {} } = {}) {
    const h = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (method !== "GET" && origin) h.origin = origin;
    let body;
    if (json !== undefined) {
      h["content-type"] = "application/json";
      body = JSON.stringify(json);
    } else if (bytes) {
      h["content-type"] = "application/octet-stream";
      body = bytes;
    }
    const response = await fetch(BASE + path, { method, headers: h, body, redirect: "manual" });
    const set = response.headers.get("set-cookie");
    if (set) this.cookie = /scroll_session=([^;]*)/.exec(set)?.[1] ? `scroll_session=${/scroll_session=([^;]*)/.exec(set)[1]}` : "";
    const type = response.headers.get("content-type") ?? "";
    const data = type.includes("json") ? await response.json() : type.startsWith("image/") ? new Uint8Array(await response.arrayBuffer()) : await response.text();
    return { status: response.status, data, headers: response.headers };
  }
  async signIn(account, { domain = HOST, uri = BASE, reuse } = {}) {
    let message = reuse?.message;
    let signature = reuse?.signature;
    if (!reuse) {
      const { data } = await this.request("/api/auth/nonce");
      const issuedAt = new Date();
      message = createSiweMessage({ address: account.address, chainId: 4663, domain, uri, nonce: data.nonce, version: "1", issuedAt, expirationTime: new Date(issuedAt.getTime() + 300000), statement: "Sign in to SCROLL." });
      signature = await account.signMessage({ message });
    }
    const result = await this.request("/api/auth/verify", { method: "POST", json: { message, signature } });
    return { ...result, message, signature };
  }
}

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(BASE + "/api/auth/me")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start:\n" + log);
}

function weekStarts() {
  // Mirrors src/core/weeks.ts with the default Sunday start.
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const current = midnight - new Date(midnight).getUTCDay() * 86400000;
  return [1, 2, 3, 4].map((i) => new Date(current - i * 7 * 86400000).toISOString().slice(0, 10));
}

async function main() {
  await waitForServer();
  const weeks = weekStarts();
  const png = (name) => readFileSync(join("tests", "fixtures", name));
  const anon = new Client();
  const alice = new Client();
  const bob = new Client();
  const reviewer = new Client();
  const aliceKey = privateKeyToAccount(generatePrivateKey());
  const bobKey = privateKeyToAccount(generatePrivateKey());

  // ── Sessions ──
  let r = await anon.request("/api/auth/me");
  check("no session by default", r.data.session === null, JSON.stringify(r.data));
  r = await anon.request("/api/auth/session", { method: "POST", json: { address: "0x0000000000000000000000000000000000000001" } });
  check("there is no back-door sign-in", r.status === 404, r.status);
  r = await anon.request("/api/submissions", { method: "POST", json: { platform: "ios", weekStart: weeks[0] } });
  check("unauthenticated create → 401", r.status === 401, r.status);

  const first = await alice.signIn(aliceKey);
  check("wallet sign-in succeeds", first.status === 200 && first.data.address === aliceKey.address.toLowerCase(), JSON.stringify(first.data));
  check("session cookie is httpOnly", /HttpOnly/i.test(first.headers.get("set-cookie") ?? ""), first.headers.get("set-cookie"));
  r = await new Client().signIn(aliceKey, { reuse: first });
  check("replayed message + signature → 401", r.status === 401, r.status);
  r = await new Client().signIn(aliceKey, { domain: "evil.example", uri: "https://evil.example" });
  check("message for another domain → 401", r.status === 401, r.status);
  r = await alice.request("/api/submissions", { method: "POST", json: { platform: "ios", weekStart: weeks[0] }, origin: "https://evil.example" });
  check("cross-origin mutation → 403", r.status === 403, r.status);
  await bob.signIn(bobKey);
  await reviewer.signIn(admin);
  r = await reviewer.request("/api/auth/me");
  check("allowlisted wallet is a reviewer", r.data.session?.isAdmin === true, JSON.stringify(r.data));
  r = await alice.request("/api/auth/me");
  check("ordinary wallet is not a reviewer", r.data.session?.isAdmin === false, JSON.stringify(r.data));

  // ── Upload ──
  r = await alice.request("/api/submissions", { method: "POST", json: { platform: "ios", weekStart: "2020-01-05" } });
  check("week outside the allowed range → 400", r.status === 400, r.status);
  r = await alice.request("/api/submissions", { method: "POST", json: { platform: "ios", weekStart: weeks[0] } });
  check("draft created", r.status === 200 && r.data.status === "draft", JSON.stringify(r.data));
  const sub = r.data.id;
  r = await alice.request(`/api/submissions/${sub}/evidence`, { method: "POST", bytes: Buffer.from("<html>not an image</html>".padEnd(200)) });
  check("disguised file → 415", r.status === 415, r.status);
  r = await alice.request(`/api/submissions/${sub}/evidence`, { method: "POST", bytes: Buffer.alloc(9 * 1024 * 1024, 1) });
  check("oversized file → 413", r.status === 413, r.status);
  r = await alice.request(`/api/submissions/${sub}/submit`, { method: "POST", json: { confirmed: true } });
  check("submit without a screenshot → 400", r.status === 400, r.status);
  r = await alice.request(`/api/submissions/${sub}/evidence`, { method: "POST", bytes: png("week-a.png") });
  check("PNG accepted, dimensions read from bytes", r.status === 200 && r.data.evidence.width === 600, JSON.stringify(r.data).slice(0, 200));
  const evidence = r.data.evidence;

  // ── Private screenshot access ──
  r = await alice.request(evidence.url);
  check("owner opens screenshot through signed URL", r.status === 200 && r.headers.get("cache-control")?.includes("no-store"), r.status);
  r = await anon.request(evidence.url);
  check("signed URL without a session → 401", r.status === 401, r.status);
  r = await bob.request(evidence.url);
  check("signed URL used by another wallet → 403", r.status === 403, r.status);
  r = await alice.request(`/api/evidence/${evidence.id}/file`);
  check("no signature → 403", r.status === 403, r.status);
  r = await alice.request(evidence.url.replace(/e=(\d+)/, (_, e) => `e=${Number(e) + 9999}`));
  check("tampered expiry → 403", r.status === 403, r.status);
  r = await bob.request(`/app/submissions/${sub}`);
  check("another wallet's submission page → 404", r.status === 404, r.status);
  r = await bob.request(`/api/submissions/${sub}/submit`, { method: "POST", json: { confirmed: true } });
  check("another wallet can't submit it → 404", r.status === 404, r.status);

  // ── Duplicates ──
  r = await bob.request("/api/submissions", { method: "POST", json: { platform: "ios", weekStart: weeks[0] } });
  const bobSub = r.data.id;
  r = await bob.request(`/api/submissions/${bobSub}/evidence`, { method: "POST", bytes: png("week-a.png") });
  check("same file from another wallet → 409", r.status === 409 && r.data.code === "duplicate_file", JSON.stringify(r.data));
  r = await alice.request(`/api/submissions/${sub}/submit`, { method: "POST", json: { confirmed: false } });
  check("submit without confirming readability → 400", r.status === 400, r.status);
  r = await alice.request(`/api/submissions/${sub}/submit`, { method: "POST", json: { confirmed: true } });
  check("submitted for review", r.status === 200 && r.data.status === "pending_review", JSON.stringify(r.data));
  r = await alice.request("/api/submissions", { method: "POST", json: { platform: "ios", weekStart: weeks[0] } });
  check("second submission for the same week → 409", r.status === 409, r.status);

  // ── Admin boundary ──
  for (const path of [`submissions/${sub}/usage`, `submissions/${sub}/decision`, "policy", "pools/fund", "payouts/run", "settings"]) {
    r = await alice.request(`/api/admin/${path}`, { method: "POST", json: { action: "approve", usage: { instagram: 60 }, payoutsEnabled: true } });
    check(`non-reviewer POST /api/admin/${path.replace(sub, ":id")} → 403`, r.status === 403, r.status);
  }
  r = await anon.request("/api/admin/payouts/run", { method: "POST", json: {} });
  check("anonymous admin call → 401", r.status === 401, r.status);
  r = await alice.request("/admin");
  check("non-reviewer sees no queue on /admin", r.status === 200 && !String(r.data).includes("Review queue") && String(r.data).includes("Not a reviewer wallet"), r.status);
  r = await reviewer.request("/admin");
  check("reviewer sees the queue", String(r.data).includes("Review queue"), r.status);

  // ── Review without a policy: approved, nothing allocated ──
  r = await bob.request(`/api/submissions/${bobSub}/evidence`, { method: "POST", bytes: png("week-c.png") });
  await bob.request(`/api/submissions/${bobSub}/submit`, { method: "POST", json: { confirmed: true } });
  r = await reviewer.request(`/api/admin/submissions/${bobSub}/decision`, { method: "POST", json: { action: "reject", reason: "" } });
  check("reject without a reason → 400", r.status === 400, r.status);
  r = await reviewer.request(`/api/admin/submissions/${bobSub}/decision`, { method: "POST", json: { action: "approve" } });
  check("approve without verified durations → 400", r.status === 400, r.status);
  await reviewer.request(`/api/admin/submissions/${bobSub}/usage`, { method: "POST", json: { usage: { reddit: 330, roblox: 192, instagram: 140 } } });
  r = await reviewer.request(`/api/admin/submissions/${bobSub}/decision`, { method: "POST", json: { action: "approve" } });
  check("no published policy → approved, zero allocations", r.status === 200 && r.data.allocations === 0, JSON.stringify(r.data));

  // ── Policy, pool, allocation ──
  const token = { address: "0x0000000000000000000000000000000000000000", decimals: 18 };
  const tickers = Object.fromEntries(["META", "SNAP", "RDDT", "NFLX", "RBLX"].map((t) => [t, { enabled: true, unitsPerMinute: "1000000000000", walletWeeklyCap: "900000000000000000", weeklyPoolLimit: "9000000000000000000", minPayout: "0" }]));
  const apps = Object.fromEntries(["instagram", "facebook", "snapchat", "reddit", "netflix", "roblox"].map((a) => [a, { maxMinutesPerWeek: 1200 }]));
  r = await reviewer.request("/api/admin/policy", { method: "POST", json: { config: { label: "verify run", tickers: { ...tickers, META: { ...tickers.META, unitsPerMinute: 0.5 } }, apps, network: { chainId: 1, tokens: { META: token } } } } });
  check("policy with a float rate → 400", r.status === 400, r.status);
  r = await reviewer.request("/api/admin/policy", { method: "POST", json: { config: { label: "verify run", tickers, apps, network: { chainId: 1, tokens: { META: token } } } } });
  check("policy draft created", r.status === 200, JSON.stringify(r.data));
  const policyId = r.data.id;
  r = await reviewer.request(`/api/admin/policy/${policyId}/publish`, { method: "POST", json: {} });
  check("policy published", r.status === 200 && r.data.version === 1, JSON.stringify(r.data));
  r = await reviewer.request(`/api/admin/policy/${policyId}`, { method: "POST", json: { config: { label: "edit", tickers, apps } } });
  check("published policy can't be edited → 409", r.status === 409, r.status);
  r = await anon.request("/");
  check("homepage shows the published policy", String(r.data).includes("Current reward policy"), "not found");

  // Alice submitted BEFORE the policy existed: her approval allocates nothing.
  await reviewer.request(`/api/admin/submissions/${sub}/usage`, { method: "POST", json: { usage: { instagram: 582, netflix: 365, reddit: 250 } } });
  r = await reviewer.request(`/api/admin/submissions/${sub}/decision`, { method: "POST", json: { action: "approve" } });
  check("submission made before the policy stays unallocated", r.status === 200 && r.data.allocations === 0, JSON.stringify(r.data));

  // A submission made after publication is allocated under it.
  r = await alice.request("/api/submissions", { method: "POST", json: { platform: "android", weekStart: weeks[1] } });
  const sub2 = r.data.id;
  await alice.request(`/api/submissions/${sub2}/evidence`, { method: "POST", bytes: png("week-b.png") });
  await alice.request(`/api/submissions/${sub2}/submit`, { method: "POST", json: { confirmed: true } });
  await reviewer.request("/api/admin/pools/fund", { method: "POST", json: { ticker: "META", amount: "1000000000000000000", note: "verify run" } });
  await reviewer.request(`/api/admin/submissions/${sub2}/usage`, { method: "POST", json: { usage: { instagram: 380, facebook: 256, snapchat: 435 } } });
  r = await reviewer.request(`/api/admin/submissions/${sub2}/decision`, { method: "POST", json: { action: "approve" } });
  check("approval allocates META (combined) and SNAP", r.status === 200 && r.data.allocations === 2, JSON.stringify(r.data));
  r = await reviewer.request(`/api/admin/submissions/${sub2}/decision`, { method: "POST", json: { action: "approve" } });
  check("deciding twice → 409", r.status === 409, r.status);
  r = await alice.request(`/app/submissions/${sub2}`);
  const page = String(r.data);
  check("user sees META 0.000636 (636 min × rate), queued", page.includes("0.000636") && page.includes("Queued"), "amount or state missing");
  check("user sees SNAP awaiting funding at full amount", page.includes("0.000435") && page.includes("Awaiting funding"), "amount or state missing");
  check("page says approval is not payment", page.includes("An approved screenshot is not a payment"), "missing");

  // ── Payouts without a treasury key: nothing runs, nothing is faked ──
  r = await reviewer.request("/api/admin/payouts/run", { method: "POST", json: {} });
  check("payout run refuses while switched off", r.data.ran === false && /switched off/.test(r.data.reason), JSON.stringify(r.data));
  await reviewer.request("/api/admin/settings", { method: "POST", json: { payoutsEnabled: true } });
  r = await reviewer.request("/api/admin/payouts/run", { method: "POST", json: {} });
  check("payout run names the missing treasury key", r.data.ran === false && /TREASURY_PRIVATE_KEY/.test(r.data.reason), JSON.stringify(r.data));
  r = await alice.request("/app/rewards");
  check("rewards page shows nothing as paid", !String(r.data).includes("Confirmed") && String(r.data).includes("Payouts aren&#x27;t live yet"), "unexpected paid state");
  r = await anon.request("/api/cron/payouts", { method: "POST", headers: { authorization: "Bearer wrong" } });
  check("cron endpoint rejects a wrong secret → 401", r.status === 401, r.status);
  r = await anon.request("/api/cron/payouts", { method: "POST", headers: { authorization: `Bearer ${cron}` } });
  check("cron endpoint runs with the secret", r.status === 200 && r.data.payouts.ran === false, JSON.stringify(r.data));

  // ── Deletion and sign-out ──
  r = await alice.request(`/api/submissions/${sub}/files`, { method: "DELETE" });
  check("owner deletes screenshot files of a decided submission", r.status === 200 && r.data.deleted === 1, JSON.stringify(r.data));
  r = await alice.request(evidence.url);
  check("deleted screenshot → 410", r.status === 410, r.status);
  const old = alice.cookie;
  await alice.request("/api/auth/logout", { method: "POST", json: {} });
  alice.cookie = old;
  r = await alice.request("/api/auth/me");
  check("signed-out cookie no longer works", r.data.session === null, JSON.stringify(r.data));
}

try {
  await main();
} catch (error) {
  failed += 1;
  console.error("ERROR", error);
  console.error(log.slice(-2000));
} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 1500));
  try {
    rmSync(join("data", DATA), { recursive: true, force: true });
  } catch {}
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
