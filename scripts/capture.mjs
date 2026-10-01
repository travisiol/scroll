// Screenshot a route with headless Chrome: node scripts/capture.mjs <path> <width> <height> <out.png> [cookie]
// Mobile widths are captured through an iframe, because Chrome enforces a ~500px minimum window.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [path = "/", width = "1536", height = "900", out = "shot.png"] = process.argv.slice(2);
const base = process.env.BASE_URL || "http://localhost:3672";
const chrome = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = mkdtempSync(join(tmpdir(), "scroll-shot-"));

let url = base + path;
let windowWidth = Number(width);
if (windowWidth < 520) {
  const html = join(profile, "frame.html");
  writeFileSync(html, `<body style="margin:0;background:#888"><iframe src="${url}" width="${width}" height="${height}" style="border:0;display:block"></iframe>`);
  url = "file:///" + html.replace(/\\/g, "/");
  windowWidth = 520;
}

const result = spawnSync(
  chrome,
  ["--headless=new", "--no-first-run", `--user-data-dir=${profile}`, "--hide-scrollbars", "--disable-web-security", `--window-size=${windowWidth},${height}`, "--virtual-time-budget=12000", `--screenshot=${resolve(out)}`, url],
  { stdio: "ignore" },
);
console.log(result.status === 0 ? `wrote ${resolve(out)}` : `chrome exited ${result.status}`);
