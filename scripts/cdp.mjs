// A minimal Chrome DevTools Protocol driver (no dependencies; Node 22+ WebSocket).
// Used by scripts/ui-flow.mjs to click through the real UI and take screenshots.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function launch({ port = 9333, chrome = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe" } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "scroll-cdp-"));
  const proc = spawn(chrome, ["--headless=new", "--no-first-run", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((t) => t.type === "page");
    } catch {}
  }
  if (!target) throw new Error("Chrome did not start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  const errors = [];
  const bindings = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method === "Runtime.bindingCalled") {
      bindings.get(msg.params.name)?.(msg.params.payload);
    } else if (msg.method === "Runtime.exceptionThrown") {
      errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      errors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  await send("Page.enable");
  await send("Runtime.enable");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const api = {
    errors,
    sleep,
    /** Run a script in every page before its own scripts. */
    async init(source) {
      await send("Page.addScriptToEvaluateOnNewDocument", { source });
    },
    /** Expose window[name](string) to the page; calls arrive in `handler`. */
    async bind(name, handler) {
      bindings.set(name, handler);
      await send("Runtime.addBinding", { name });
    },
    async size(width, height, mobile = false) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
    },
    async goto(url, wait = 1500) {
      await send("Page.navigate", { url });
      await sleep(wait);
    },
    async eval(expression) {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    /** Wait until `expression` is truthy. */
    async until(expression, timeout = 15000) {
      const start = Date.now();
      for (;;) {
        if (await api.eval(expression).catch(() => false)) return;
        if (Date.now() - start > timeout) throw new Error(`timed out waiting for: ${expression}`);
        await sleep(200);
      }
    },
    /** Click the first button/link/role=radio whose visible text contains `text`. */
    async click(text) {
      const ok = await api.eval(`(() => {
        const els = [...document.querySelectorAll('button, a, [role=radio], label, summary')].filter((e) => e.offsetParent !== null);
        const el = els.find((e) => e.textContent.trim() === ${JSON.stringify(text)}) ?? els.find((e) => e.textContent.includes(${JSON.stringify(text)}));
        if (!el || el.disabled) return false;
        el.click();
        return true;
      })()`);
      if (!ok) throw new Error(`nothing clickable with text: ${text}`);
      await sleep(350);
    },
    async text() {
      return api.eval("document.body.innerText");
    },
    async shot(file, { full = false } = {}) {
      let clip;
      if (full) {
        const { cssContentSize } = await send("Page.getLayoutMetrics");
        clip = { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 };
      }
      const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full, clip });
      writeFileSync(file, Buffer.from(data, "base64"));
    },
    async close() {
      ws.close();
      proc.kill();
    },
  };
  return api;
}
