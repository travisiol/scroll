// Payout + retention worker: calls the running app on a schedule.
//   CRON_SECRET=... APP_URL=http://localhost:3672 npm run worker
// All state lives in the database; this process can be stopped and restarted at any time.
const url = (process.env.APP_URL || "http://localhost:3672") + "/api/cron/payouts";
const secret = process.env.CRON_SECRET;
const every = Number(process.env.WORKER_INTERVAL_SECONDS || 30) * 1000;
if (!secret) {
  console.error("CRON_SECRET is not set (it must match the app's CRON_SECRET).");
  process.exit(1);
}
async function run() {
  try {
    const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
    console.log(new Date().toISOString(), response.status, JSON.stringify(await response.json()));
  } catch (error) {
    console.error(new Date().toISOString(), "worker call failed:", error.message);
  }
}
await run();
if (!process.argv.includes("--once")) setInterval(run, every);
