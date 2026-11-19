# Aviator real-money hardening plan

Status: partial hardening committed. Legacy Aviator wagering is intentionally disabled. Firestore bet settlement, authenticated sockets, and persistent round history are not implemented; this is not production-ready.

## Required player-funds rules
- Remove all demo/default balances and user-triggered demo top-ups.
- A new wallet starts at 0 ETB.
- A Telebirr deposit request remains pending and unavailable until an authorized admin verifies and approves it.
- Reject client-side balance writes and caller-supplied player identity. Authenticate players server-side.
- Do not permit betting unless the authenticated player's available Firestore wallet balance covers the bet.
- Bets, cancellations/refunds, cash-outs, withdrawals and deposit approvals must use server-side Firestore transactions, idempotency keys and an immutable ledger.
- No client or socket event may create funds, change a balance, or claim rewards.
- Keep admin authorization server-side; never trust an admin flag or UID supplied by a client.

## Aviator game and room integrity
- Remove simulated/bot bets, fabricated player counts, seeded fake winners, fake rewards/rain bonuses and hard-coded historical rounds.
- Show live room counts and bet feeds only from real, verified game activity.
- Show historical crash results only when backed by persisted, verifiable round records. Do not present seeded sample values as real history.
- Build leaderboard entries only from settled, verified cash-outs.
- Keep round state, bet placement, cancellation, cash-out and settlement authoritative on the server.
- Make every debit, refund and payout idempotent and auditable. A retry must not debit or credit twice.
- Preserve verifiable fairness proofs and publish the round proof only after the round has settled.

## Authentication and transport security
- Verify Firebase Authentication ID tokens on all player HTTP endpoints.
- Authenticate Socket.IO connections and authorize every player action against the authenticated UID; do not trust playerId from request bodies, query strings, headers or socket handshake fields.
- Restrict CORS to configured trusted origins.
- Deny direct client Firestore writes to wallet balances, ledger entries, bets and settlement records.
- Verify Telegram Mini App initData server-side before linking Telegram identity to a Firebase UID.

## Delivery sequence
1. [PARTIAL] Set new in-memory wallets to zero, block legacy Aviator wager/top-up paths, and remove simulated bets, seeded winners, fabricated counts, fake rain/chat and unpersisted history.
2. [NOT DONE] Replace in-memory Aviator balance operations with the secure Firestore wallet service.
3. [NOT DONE] Implement authenticated bet debit, waiting-round cancellation/refund, cash-out credit and crash loss settlement with atomic transactions and idempotency.
4. [NOT DONE] Persist round, bet and settlement history; verify fairness proofs.
5. Add and run tests for zero-balance accounts, pending/unapproved deposits, insufficient funds, unauthorized HTTP/socket requests, duplicate requests, cancellation, cash-out, crash settlement and concurrent requests.
6. Review Firestore security rules and admin approval controls.
7. Only after independent security and compliance review, consider enabling real-money play.

## Explicit safety gate
Do not enable live deposits or real-money wagering until all authentication, wallet, game settlement, audit, fairness, recovery and concurrency tests pass; the production Firebase configuration and rules are verified; and applicable gambling/payment licensing and legal requirements are satisfied.

## Scope note
This plan applies to Aviator first. The other five games must be migrated separately after Aviator has been fully tested. Do not remove or overwrite unrelated game code as part of this task.

## Current implementation note
The initial hardening commit series removes the legacy demo top-up and simulated Aviator room activity and makes all Aviator bet/cancel/cash-out methods fail closed. It does not yet connect Aviator to Firestore. Do not re-enable wagering by changing a flag; the server-side Firestore wallet and settlement implementation, authentication, persistence and tests must be completed first.
