# Firestore wallet migration — safety foundation

This branch is an interim safety patch, not the completed Firestore migration.

## Safety changes
- New player balances start at 0 ETB; no demo money is granted.
- Public browser deposit requests no longer credit balances.
- Demo reward endpoint no longer credits balances.
- Seeded sample winner fixtures are removed so fake wins are not shown as real.
- Deposit UI explains that deposits are paused pending the secure migration.

## Why deposits are paused
The existing wallet is process-memory only. The current browser API trusts a client-supplied playerId, and the current deposit route immediately credits that ID. That is not safe for real funds.

## Required next migration steps
1. Verify Telegram Mini App initData server-side using TELEGRAM_BOT_TOKEN.
2. Derive the player UID only from verified Telegram identity (never from request body/query).
3. Store wallet balances and immutable ledger entries in Gamesporo18 Firestore.
4. Use Firestore transactions and idempotency keys for every debit/credit.
5. Create pending Telebirr deposit requests; credit only after an authorized admin approves.
6. Add admin authentication/authorization and audit logs.
7. Move every game bet, payout, and withdrawal to the same transactional Firestore wallet.
8. Add tests for concurrent bets, duplicate approvals, forged identities, insufficient funds, and restarts.

## Environment
Keep FIREBASE_SERVICE_ACCOUNT_JSON, TELEGRAM_BOT_TOKEN, and admin IDs in Render secret environment variables only. Never commit service-account JSON or bot tokens.
