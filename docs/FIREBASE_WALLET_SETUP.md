# gamesporo18 Firestore wallet setup

This branch contains a server-side Firestore wallet foundation. It is deliberately fail-closed: Aviator bets, cancellations and cash-outs remain disabled until the full game integration and tests are complete.

## Render / server environment

Set these values in the server environment, never in GitHub source files:

- `FIREBASE_PROJECT_ID=gamesporo18`
- `FIREBASE_SERVICE_ACCOUNT_JSON` **or** `FIREBASE_SERVICE_ACCOUNT_BASE64`: service-account credentials from the gamesporo18 Firebase project. Keep this secret private.
- `FIREBASE_ADMIN_UIDS`: comma-separated Firebase Authentication UIDs authorized to review deposits. Do not use a Telegram ID or an email address here.
- `CORS_ORIGINS`: comma-separated exact HTTPS origins allowed to call the API and Aviator Socket.IO namespace, for example the production site origin. Do not include paths or trailing slashes.

The Firebase Web SDK configuration is now installed in `index.html`, with Email/Password sign-in and account registration. Firebase Auth persistence is set to in-memory only; users must sign in again after a full page reload. The browser obtains a Firebase Authentication ID token and passes it to the API as a Bearer token and to the Aviator iframe through the in-memory `window.liteGamesFirebaseIdToken` value. The iframe no longer creates or copies legacy localStorage player IDs. A localStorage player ID or Telegram `initDataUnsafe` is not authentication.

## Firestore deployment

From the repository root, after selecting the gamesporo18 Firebase project:

```sh
firebase use gamesporo18
firebase deploy --only firestore:rules,firestore:indexes
```

The rules in `firestore.rules` deny direct client access to wallet, deposit, ledger and Aviator records. The Admin SDK on the server performs approved writes. The index configuration supports pending Telebirr review and Aviator bet history queries.

## Telebirr deposit flow

1. A signed-in player submits the amount and the Telebirr transaction reference.
2. The server creates a `PENDING` request. The balance does not change.
3. An authenticated UID listed in `FIREBASE_ADMIN_UIDS` approves or rejects the request.
4. Approval and the wallet credit happen in one Firestore transaction and create a ledger record.
5. The same Telebirr reference cannot be submitted under a second account.

## Aviator status

- New balances start at 0 ETB.
- Round lifecycle and fairness proof records are written to Firestore.
- Player HTTP state/history and Aviator sockets require verified Firebase ID tokens.
- Socket player identity comes from the verified token, not from request payloads.
- The current bet/cancel/cash-out entry points intentionally reject wagers. The Firestore transaction service is present, but the live game loop has not yet been switched over to it end-to-end.
- Browser Email/Password sign-in and account registration are wired in `index.html`; they still require a live browser/Firebase test against the deployed site.

Do not enable real-money play or merge this branch as production-ready until browser authentication, Firestore round/bet concurrency, bet debit/refund/payout settlement, crash recovery, fairness verification and the full automated test suite have been validated.
