# Security and persistence audit — Lite Games

Audit branch: `firebase-wallet-admin`
Base branch at audit start: `main`
Firebase project configured by owner: `Gamesporo18`
Admin Telegram ID supplied by owner: `7396414604`

## Executive summary

The current branch is not safe for real-money deposits or wagering. The main wallet is process-memory-only, and public APIs accept caller-selected player IDs. Several game backends expose direct demo credit endpoints. The Telegram bot currently registers users on `/start`, but registration does not authenticate requests to the website or game APIs.

No production deployment or merge is authorized by this audit.

## Confirmed findings

1. **Wallet data is volatile.** `shared/wallet.js` stores player balances, transactions, rewards, and winners in JavaScript `Map`/arrays. A restart loses that data. The six game balance managers also keep bet history and idempotency keys in process memory.
2. **Client identity is not authenticated.** `shared/wallet-routes.js` accepts `playerId` from the request body, query string, or `X-Player-Id` header. The game REST APIs follow the same pattern. A caller can choose another player's ID.
3. **Deposit endpoint credits instantly.** `POST /api/wallet/deposit` directly increases a balance. It does not create a pending Telebirr request, verify a transaction reference, or require administrator approval.
4. **Demo credit routes are exposed.** Game APIs expose `/topup` or `/bonus` routes, and game Socket.IO handlers include top-up/bonus events. These must not remain available to public players.
5. **Socket.IO trusts client identity.** Game rooms accept `player:identify` and subsequent bet events with client-supplied player IDs. Securing only the REST endpoints would leave a bypass.
6. **Telegram onboarding is not authentication.** `bot.js` records `telegramUsers/{telegramId}` after `/start`, then launches the Mini App. The server does not validate Telegram Mini App `initData` on wallet/game requests.
7. **No safe direct Firestore swap exists.** Existing game room and balance manager methods are synchronous and rely on immediate in-memory balance getters/setters. A durable Firestore wallet requires an asynchronous transactional ledger refactor across all six games, not merely changing `shared/wallet.js`.
8. **Deployment secrets are external prerequisites.** The worker expects `TELEGRAM_BOT_TOKEN`, `MINI_APP_URL`, and `FIREBASE_SERVICE_ACCOUNT_JSON`. Secrets must remain in Render environment settings and must never be committed to GitHub.

## Required implementation sequence

1. Add server-side Telegram Mini App `initData` HMAC verification, freshness checks, and authenticated identity middleware. Enforce it on every wallet/game REST route and Socket.IO handshake; derive player identity only from verified Telegram data.
2. Replace the in-memory wallet with Firestore-backed accounts and a transaction ledger. Use Firestore transactions for debit, payout, refund, deposit approval, and idempotency. Persist all six game balances against the same Telegram/Firebase user identity.
3. Remove public top-up/bonus credit paths. Add Telebirr deposit requests with amount, transaction reference, evidence metadata, duplicate-reference protection, pending/approved/rejected states, and no credit until an authenticated admin approves.
4. Authorize the admin only when the verified Telegram ID equals `ADMIN_TELEGRAM_ID=7396414604`. Protect all admin endpoints and audit every decision.
5. Update the Mini App and all six game clients to use the authenticated session and pending-deposit UX. Do not trust player IDs in URLs or request payloads.
6. Add automated tests for authentication, authorization, Firestore transaction idempotency, concurrent debits, duplicate deposits, and all six game integrations.
7. Deploy only after tests pass and Render secrets are present. Verify health, logs, and Telegram polling has exactly one active worker.

## Release safety

Until the full sequence is implemented and tested, do not accept real funds or advertise the platform as production-ready. Do not merge this branch or deploy it merely because the audit document exists.
