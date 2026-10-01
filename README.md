# SCROLL

**You scroll it. Now own a piece.** Users connect a wallet, upload a screenshot of their weekly iOS Screen Time or Android Digital Wellbeing report, a person reviews it, and eligible usage is rewarded with tokenized stock from SCROLL's own funded pool.

| App | Token |
| --- | --- |
| Instagram + Facebook (combined) | META |
| Snapchat | SNAP |
| Reddit | RDDT |
| Netflix | NFLX |
| Roblox | RBLX |

Rewards are funded by SCROLL. Listed companies are not partners or sponsors.

## Run it

Requires Node 22.13+. No database server or Docker needed locally.

```bash
npm install
cp .env.example .env.local   # then fill in ADMIN_WALLETS and APP_SECRET
npm run dev                  # http://localhost:3672
```

There is no demo mode, no sample data and no simulated payout. A new account is empty until its owner uploads something, and anything that can't run yet says why (Admin → Network lists the exact gaps). With only `ADMIN_WALLETS` set, the app already works end to end up to allocation: wallet sign-in, upload, review, policy, pools.

## Setup for a real deployment

| What | How |
| --- | --- |
| Reviewers | `ADMIN_WALLETS=0xabc…,0xdef…`. Checked on the server on every request. Sign in at `/admin` with one of those wallets. Not sure of your address? Sign in, open `/admin`, and it shows the address to add. |
| Secrets | `APP_SECRET` (32+ chars, signs screenshot URLs), `APP_ORIGINS` (your public origin; sign-in refuses messages for any other). |
| Database | `DATABASE_URL` → PostgreSQL, then `npm run db:migrate`. Migrations are in `drizzle/`; regenerate with `npm run db:generate` after editing `src/db/schema.ts`. |
| Network | `RPC_URL` → a dedicated Robinhood Chain endpoint (the public one is rate-limited). `npm run verify:tokens` re-checks chain ID and the five token contracts against Robinhood's asset list and the chain. |
| Treasury | `TREASURY_PRIVATE_KEY` → the wallet holding the reward tokens and ETH for gas. Server-side only. |
| Reward policy | Admin → Policy: create a draft, publish it. Nothing is allocated until a policy is published, and a submission keeps the version in force when it was submitted. |
| Pool funding | Send tokens to the treasury wallet, then Admin → Pools → Record funding. |
| Payouts | Admin → Network → Turn payouts on. Then either press **Run payouts now**, or set `CRON_SECRET` and run `npm run worker` (or have any scheduler `POST /api/cron/payouts` with `Authorization: Bearer $CRON_SECRET`). |
| Screenshot storage | Local private disk by default (`data/local/evidence`). For production implement the three-method `StorageDriver` in `src/server/storage.ts` against a private bucket; the signed-URL layer doesn't change. |

Never put the treasury key in a `NEXT_PUBLIC_` variable. Nothing in this repo deploys or moves funds on its own.

## How it's built

Next.js 16 (App Router) · Tailwind 4 · Drizzle ORM on PostgreSQL (PGlite embedded locally, `pg` in production) · wagmi 3 + viem.

```
src/config/     apps → tickers, verified network + token addresses, upload limits
src/core/       pure logic: durations, weeks, exact units, policy maths, image sniffing, states
src/db/         schema + client          drizzle/   SQL migrations
src/server/     auth, submissions, review, allocations (pool reservation), policies,
                payouts/ (adapter interface, EVM adapter, worker), storage
src/app/        / · /app (dashboard, upload, submissions/[id], rewards, settings) · /admin · /api
```

Things worth knowing before changing them:

- **Sign-in** is EIP-4361. The server issues a one-time nonce (10 min), requires the message to name the request's own host and origin, burns the nonce *before* checking the signature, and stores only a hash of the session token. Connecting a wallet is not signing in. No approvals are ever requested.
- **Review status and payout state are separate.** Review: draft, pending review, needs changes, approved, rejected. Payout, per token: allocated, awaiting funding, queued, submitted, confirmed, failed (or "not allocated"). Approved is not paid.
- **Amounts** are integer base units (`bigint` in code, `NUMERIC(78,0)` in Postgres, decimal strings in JSON). No floats anywhere on the settlement path.
- **One duration per app per submission**, entered by the reviewer, whatever the number of screenshots. That is what stops overlapping screenshots double-counting.
- **Pool reservation** is a conditional `UPDATE … WHERE funded − reserved − paid >= amount` inside the approval transaction. If it matches nothing the allocation waits in *awaiting funding* at its full amount; it is never shrunk to fit.
- **Payouts can't double-pay**: a transfer is signed and its hash stored before broadcast; a job with an unresolved transfer is only ever reconciled (same signed bytes re-sent at most); a new transfer needs the old one to have provably failed; a unique index allows one open transfer per job; "paid" requires a confirmed receipt containing the expected `Transfer` event.
- **Screenshots** are served only by `/api/evidence/[id]/file`: session + 5-minute signature bound to the viewer + ownership or reviewer role. Files are deleted `NEXT_PUBLIC_EVIDENCE_RETENTION_DAYS` (90) after a decision; users can delete them sooner. Fingerprints and verified durations are kept.

## Verify

```bash
npm test                 # 37 tests: core maths + database flows (in-memory Postgres, test-only chain double)
npm run typecheck && npm run lint && npm run build
node scripts/verify-api.mjs   # 58 HTTP checks against the production build, isolated data
OUT=shots node scripts/ui-flow.mjs   # 31 checks clicking through the UI with a wallet that really signs, isolated data
```

## What still needs you

- **Your reviewer wallet** in `ADMIN_WALLETS`.
- **A reward policy.** Rates, caps, pool limits and minimums are business decisions. The app ships with none.
- **Treasury key, funding, dedicated RPC.** Without them payouts stay off and the app says so.
- **Issuer and jurisdiction checks.** The five tokens exist on Robinhood Chain (verified), but whether the issuer lets arbitrary wallets receive them, and where SCROLL may offer this, is not something code can settle. The EVM adapter simulates each transfer before signing, so a restricted token shows up as a setup error with nothing sent. The live transfer path has not been run against the real chain.
- **Token units.** Stock tokens here use scaled UI amounts (a multiplier that moves with splits and dividends). SCROLL allocates and transfers raw ERC-20 base units; confirm with the issuer's docs how that should be presented to users.
- **Production storage and Postgres.** The S3-style driver is an interface, not an implementation. Concurrency tests run on embedded Postgres, which serialises connections; the reservation logic is a single conditional UPDATE, but run `npm test` against real Postgres before launch.
- **Not built:** OCR assistance (review is manual by design), WalletConnect (browser/in-app wallets only), rate limiting, email/push notifications, fiat values (no price source).
