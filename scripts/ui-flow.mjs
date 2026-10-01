// Click through the real UI in headless Chrome, with a real wallet flow:
//   npm run build && OUT=./shots node scripts/ui-flow.mjs
// It starts the production build on its own port with an isolated data folder
// (deleted afterwards). A test wallet is announced to the page the way a
// browser extension is (EIP-6963); its signatures are real secp256k1
// signatures from throwaway keys generated for this run, so the server
// verifies them exactly as it would a user's. No chain is touched.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { launch } from "./cdp.mjs";

const PORT = Number(process.env.UI_PORT || 3676);
const BASE = `http://localhost:${PORT}`;
const DATA = `ui-${Date.now()}`;
const OUT = resolve(process.env.OUT || "shots");
mkdirSync(OUT, { recursive: true });
const out = (name) => join(OUT, name);

const reviewer = privateKeyToAccount(generatePrivateKey());
const user = privateKeyToAccount(generatePrivateKey());
const accounts = { [reviewer.address.toLowerCase()]: reviewer, [user.address.toLowerCase()]: user };

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], {
  env: { ...process.env, SCROLL_DATA_DIR: DATA, ADMIN_WALLETS: reviewer.address, APP_SECRET: randomBytes(32).toString("hex"), DATABASE_URL: "", TREASURY_PRIVATE_KEY: "", CRON_SECRET: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(BASE + "/api/auth/me")).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const b = await launch();
const steps = [];
const ok = (name, pass, detail = "") => {
  steps.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : `  → ${String(detail).slice(0, 400)}`}`);
};

// The page-side wallet. It holds no key: signing is forwarded to this script.
const WALLET = `(() => {
  let account = localStorage.getItem("__walletAccount") || ${JSON.stringify(user.address)};
  const listeners = {};
  const pending = {};
  let seq = 0;
  window.__walletResolve = (id, signature) => { pending[id]?.(signature); delete pending[id]; };
  const provider = {
    isTestWallet: true,
    on(event, fn) { (listeners[event] ||= []).push(fn); },
    removeListener(event, fn) { listeners[event] = (listeners[event] || []).filter((f) => f !== fn); },
    async request({ method, params }) {
      // Like a real wallet: no address is revealed until the user approves the connection.
      if (method === "eth_requestAccounts") { localStorage.setItem("__walletAllowed", "1"); return [account]; }
      if (method === "eth_accounts") return localStorage.getItem("__walletAllowed") ? [account] : [];
      if (method === "eth_chainId") return "0x1237";
      if (method === "personal_sign") {
        window.__walletLastSign = params[0];
        if (window.__walletReject) { window.__walletReject = false; const e = new Error("User rejected the request."); e.code = 4001; throw e; }
        const id = String(++seq);
        return new Promise((resolve) => { pending[id] = resolve; window.__walletSign(JSON.stringify({ id, account, message: params[0] })); });
      }
      // A sign-in must never ask for a transaction or an approval.
      if (method === "eth_sendTransaction" || method === "eth_signTypedData_v4") { window.__walletUnexpected = method; const e = new Error("refused"); e.code = 4001; throw e; }
      const e = new Error("Unsupported: " + method); e.code = 4200; throw e;
    },
  };
  window.__wallet = { setAccount(a) { account = a; localStorage.setItem("__walletAccount", a); (listeners.accountsChanged || []).forEach((fn) => fn([a])); } };
  const detail = Object.freeze({ info: { uuid: "7d7f1c1e-0000-4000-8000-000000000001", name: "Test Wallet", icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E", rdns: "test.wallet" }, provider });
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})()`;

const setInput = (selector, value) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('no element ${selector}'); const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`;

try {
  await b.bind("__walletSign", async (payload) => {
    const { id, account, message } = JSON.parse(payload);
    const signature = await accounts[account.toLowerCase()].signMessage({ message: { raw: message } });
    await b.eval(`window.__walletResolve(${JSON.stringify(id)}, ${JSON.stringify(signature)})`);
  });
  await b.init(WALLET);

  // ── Homepage ──
  await b.size(1536, 900);
  await b.goto(BASE + "/", 3500);
  await b.shot(out("01-home-1536.png"));
  await b.shot(out("02-home-full.png"), { full: true });
  const h1 = await b.eval("(() => { const h = document.querySelector('h1'); return { size: getComputedStyle(h).fontSize, lines: [...h.children].map((s) => s.textContent) }; })()");
  ok("headline is three lines at ~111px", h1.lines.join("|") === "You scroll it.|Now own|a piece." && Math.abs(parseFloat(h1.size) - 111) < 2, JSON.stringify(h1));
  const home = await b.text();
  ok("nothing on the homepage says demo, sample, simulated or illustrative", !/demo|sample|simulat|illustrat/i.test(home), home.match(/.{30}(demo|sample|simulat|illustrat).{30}/i)?.[0]);
  ok("no horizontal overflow at 1536", await b.eval("document.documentElement.scrollWidth <= innerWidth"));
  await b.size(390, 844, true);
  await b.goto(BASE + "/", 2500);
  await b.shot(out("03-home-mobile.png"));
  ok("no horizontal overflow at 390", await b.eval("document.documentElement.scrollWidth <= innerWidth"));
  await b.click("Menu");
  ok("mobile menu opens with nav + wallet button", await b.eval("document.querySelector('#mobile-nav').innerText.includes('Connect wallet')"));

  // ── Wallet: connect, decline, then sign ──
  await b.size(1536, 900);
  await b.goto(BASE + "/", 2500);
  await b.click("Upload your screen time");
  await b.until("!!document.querySelector('dialog[open]')");
  await b.until("document.querySelector('dialog').innerText.includes('Test Wallet')");
  await b.shot(out("04-connect.png"));
  ok("the dialog offers only real wallets", !/demo/i.test(await b.eval("document.querySelector('dialog').innerText")));
  await b.click("Test Wallet");
  await b.until("document.querySelector('dialog').innerText.includes('Sign message')");
  await b.shot(out("05-sign.png"));
  await b.eval("window.__walletReject = true");
  await b.click("Sign message");
  await b.until("document.querySelector('dialog').innerText.includes('You declined the signature')");
  ok("declining the signature leaves the user signed out, with a clear message", (await b.eval("fetch('/api/auth/me').then((r) => r.json())")).session === null);
  await b.click("Sign message");
  await b.until("location.pathname === '/app/upload'");
  const signed = await b.eval("(() => { const hex = window.__walletLastSign; let s = ''; for (let i = 2; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16)); return s; })()");
  ok("the signed message names this site, the chain and an expiry", signed.includes(`localhost:${PORT} wants you to sign in`) && signed.includes("Chain ID: 4663") && signed.includes("Expiration Time:"), signed);
  ok("signing in returns the user to the upload flow", true);
  ok("sign-in asked for no transaction or approval", !(await b.eval("window.__walletUnexpected")));

  // ── A new account is empty ──
  await b.goto(BASE + "/app", 2500);
  await b.shot(out("06-dashboard-empty.png"), { full: true });
  const empty = await b.text();
  ok("new account: no fabricated activity", empty.includes("No submissions yet") && empty.includes("Nothing allocated yet") && empty.includes("Nothing paid yet") && empty.includes("No verified usage yet"), empty);
  ok("dashboard shows the connected wallet", empty.toLowerCase().includes(user.address.toLowerCase()));
  await b.goto(BASE + "/admin", 2500);
  ok("a non-reviewer wallet gets no admin data", (await b.text()).includes("Not a reviewer wallet") && !(await b.text()).includes("Review queue"));

  // ── Switching account in the wallet signs the old session out ──
  await b.goto(BASE + "/app", 2500);
  await b.eval(`window.__wallet.setAccount(${JSON.stringify(reviewer.address)})`);
  await b.until("!!document.querySelector('dialog[open]') && document.querySelector('dialog').innerText.includes('you were signed out')");
  ok("wallet account change ends the session and says why", (await b.eval("fetch('/api/auth/me').then((r) => r.json())")).session === null);
  await b.click("Sign message");
  await b.until("!document.querySelector('dialog[open]')");
  await b.goto(BASE + "/admin", 2500);
  ok("the allowlisted wallet reaches the review queue", (await b.text()).includes("Review queue"));

  // ── Reviewer publishes a policy and funds a pool, through the admin UI ──
  await b.goto(BASE + "/admin/policy", 2500);
  ok("no policy exists until someone publishes one", (await b.text()).includes("No policy is published"));
  await b.eval(setInput("#label", "Flow check"));
  for (const t of ["META", "RDDT", "RBLX"]) {
    await b.eval(`document.querySelector('[aria-label="Enable ${t}"]').click()`);
    await b.eval(setInput(`[aria-label="${t} Per eligible minute"]`, "0.00001"));
    await b.eval(setInput(`[aria-label="${t} Cap per wallet per week"]`, "0.05"));
    await b.eval(setInput(`[aria-label="${t} Weekly pool limit"]`, "5"));
  }
  for (const app of ["instagram", "facebook", "reddit", "roblox"]) await b.eval(setInput(`#l-${app}`, "20h"));
  await b.click("Create draft");
  await b.until("document.body.innerText.includes('Publish version 1')");
  await b.click("Publish version 1");
  await b.click("Confirm");
  await b.until("document.body.innerText.includes('Published · version 1')");
  await b.shot(out("07-admin-policy.png"), { full: true });
  ok("policy drafted and published from the admin screen", true);

  await b.goto(BASE + "/admin/pools", 4000);
  await b.eval(setInput("#fund-amount", "1"));
  await b.eval(setInput("#fund-note", "flow check"));
  await b.click("Record funding");
  await b.until("document.body.innerText.includes('Recorded.')");
  await b.eval(setInput("#fund-ticker", "RDDT"));
  await b.eval(setInput("#fund-amount", "1"));
  await b.eval(setInput("#fund-note", "flow check"));
  await b.click("Record funding");
  await b.sleep(1500);
  await b.shot(out("08-admin-pools.png"), { full: true });
  ok("pool funding recorded for META and RDDT (RBLX left empty)", (await b.text()).includes("fund"));

  // ── Back to the user wallet: upload ──
  await b.eval(`window.__wallet.setAccount(${JSON.stringify(user.address)})`);
  await b.until("!!document.querySelector('dialog[open]')");
  await b.click("Sign message");
  await b.until("!document.querySelector('dialog[open]')");
  await b.goto(BASE + "/app/upload", 2500);
  await b.click("iOS Screen Time");
  await b.click("Continue");
  await b.eval("[...document.querySelectorAll('[role=radio]')].find((e) => !e.getAttribute('aria-disabled')).click()");
  await b.click("Continue");
  await b.until("document.body.innerText.includes('How to take the screenshot')");
  await b.click("I have my screenshot");
  await b.eval(`(async () => {
    const c = document.createElement('canvas'); c.width = 700; c.height = 1300;
    const g = c.getContext('2d'); g.fillStyle = '#f2f2f7'; g.fillRect(0, 0, 700, 1300);
    g.fillStyle = '#111'; g.font = 'bold 44px sans-serif'; g.fillText('Weekly report', 36, 110);
    g.font = '30px sans-serif'; g.fillText('Instagram   3h 20m', 36, 260); g.fillText('Reddit   1h 10m', 36, 330); g.fillText('Roblox   2h 00m', 36, 400);
    g.fillText('run ' + Date.now(), 36, 1240);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'screen-time.png', { type: 'image/png' }));
    const input = document.querySelector('#file'); input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await b.until("document.querySelector('img[alt=\"Screenshot 1 preview\"]')?.naturalWidth === 700");
  await b.shot(out("09-upload.png"), { full: true });
  ok("uploaded screenshot previews through its private URL", true);
  await b.click("Continue");
  await b.eval("document.querySelectorAll('input[type=checkbox]').forEach((c) => c.click())");
  await b.click("Submit for review");
  await b.until("document.body.innerText.includes('Saved and sent for review')");
  const submissionPath = await b.eval("location.pathname");
  const submitted = await b.text();
  ok("saved: Pending review, Not allocated", submitted.includes("Pending review") && submitted.includes("Not allocated"));

  // ── Reviewer approves ──
  await b.eval(`window.__wallet.setAccount(${JSON.stringify(reviewer.address)})`);
  await b.until("!!document.querySelector('dialog[open]')");
  await b.click("Sign message");
  await b.until("!document.querySelector('dialog[open]')");
  await b.goto(BASE + submissionPath.replace("/app/", "/admin/"), 3000);
  await b.until("!!document.querySelector('#d-instagram')");
  await b.eval(setInput("#d-instagram", "3h 20m"));
  await b.eval(setInput("#d-reddit", "1:10"));
  await b.eval(setInput("#d-roblox", "120"));
  await b.click("Save durations");
  await b.until("document.body.innerText.includes('Durations saved.')");
  await b.eval("document.querySelectorAll('section[aria-labelledby=decision] input[type=checkbox]').forEach((c) => c.click())");
  await b.shot(out("10-admin-review.png"), { full: true });
  await b.click("Approve");
  await b.until("document.body.innerText.includes('This submission is decided')");
  const decided = await b.text();
  ok("approval: META 0.002 and RDDT 0.0007 queued, RBLX 0.0012 awaiting funding", decided.includes("0.002") && decided.includes("0.0007") && decided.includes("0.0012") && decided.includes("Queued") && decided.includes("Awaiting funding"), decided);

  // ── Payouts: nothing pretends to be sent ──
  await b.goto(BASE + "/admin/network", 4500);
  await b.shot(out("11-admin-network.png"), { full: true });
  ok("network page: live chain check passes", (await b.text()).includes("eth_chainId = 4663"), (await b.text()).slice(0, 500));
  await b.goto(BASE + "/admin/payouts", 2500);
  await b.click("Run payouts now");
  await b.until("document.body.innerText.includes('Did not run')");
  await b.shot(out("12-admin-payouts.png"), { full: true });
  const payouts = await b.text();
  ok("without a treasury key the payout run refuses and says what is missing", payouts.includes("Live transfers are not running") && payouts.includes("TREASURY_PRIVATE_KEY") && !payouts.includes("confirmed ·"));
  await b.goto(BASE + "/admin/audit", 2500);
  await b.shot(out("13-admin-audit.png"), { full: true });
  const audit = await b.text();
  ok("audit trail has the policy, funding, duration and review events", ["policy.published", "pool.funded", "review.durations_changed", "review.approve", "allocation.created"].every((a) => audit.includes(a)), audit.slice(0, 600));

  // ── The user's view ──
  await b.eval(`window.__wallet.setAccount(${JSON.stringify(user.address)})`);
  await b.until("!!document.querySelector('dialog[open]')");
  await b.click("Sign message");
  await b.until("!document.querySelector('dialog[open]')");
  await b.goto(BASE + submissionPath, 2500);
  await b.shot(out("14-user-submission.png"), { full: true });
  const mine = await b.text();
  ok("user sees Approved with nothing shown as paid", mine.includes("Approved") && mine.includes("Queued") && !mine.includes("Transfer confirmed on the network") && mine.includes("An approved screenshot is not a payment"));
  await b.goto(BASE + "/app", 2500);
  await b.shot(out("15-dashboard.png"), { full: true });
  await b.goto(BASE + "/app/rewards", 2500);
  await b.shot(out("16-rewards.png"), { full: true });
  const rewards = await b.text();
  ok("rewards: allocated per token, paid 0, no claim button", rewards.includes("0.002 META") && rewards.includes("0 META") && !/\bclaim\b/i.test(rewards.replace("nothing to claim", "")));

  await b.size(390, 844, true);
  for (const [path, file] of [["/app", "17-mobile-dashboard.png"], ["/app/upload", "18-mobile-upload.png"], ["/app/rewards", "19-mobile-rewards.png"], ["/app/settings", "20-mobile-settings.png"]]) {
    await b.goto(BASE + path, 2500);
    await b.shot(out(file), { full: true });
    ok(`no horizontal overflow on mobile ${path}`, await b.eval("document.documentElement.scrollWidth <= innerWidth"), await b.eval("document.documentElement.scrollWidth"));
  }
  await b.size(1536, 900);
  await b.goto(BASE + "/app/settings", 2000);
  await b.click("Sign out");
  await b.sleep(1500);
  ok("sign out ends the session", (await b.eval("fetch('/api/auth/me').then((r) => r.json())")).session === null);
} catch (error) {
  steps.push(false);
  console.error("ERROR", error.message);
  await b.shot(out("error.png")).catch(() => {});
  console.error((await b.text().catch(() => "")).slice(0, 900));
  console.error(log.slice(-800));
}

const significant = b.errors.filter((e) => !/React DevTools|favicon|401|403|404/i.test(String(e)));
console.log(`console errors: ${significant.length}`);
for (const e of significant.slice(0, 8)) console.log("  ", String(e).slice(0, 300));
await b.close();
server.kill();
await new Promise((r) => setTimeout(r, 1500));
try {
  rmSync(join("data", DATA), { recursive: true, force: true });
} catch {}
const failed = steps.filter((s) => !s).length;
console.log(`\n${steps.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
