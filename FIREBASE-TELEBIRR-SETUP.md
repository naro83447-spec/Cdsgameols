# Firebase + Telebirr setup (Lite Games)

This repository intentionally contains **no Firebase private key, Telebirr password, API secret, or admin UID**. Add those values in the hosting provider's secret/environment settings, never in Git.

## Required Render environment variables

- `FIREBASE_PROJECT_ID`: Firebase project ID (for this project, `Gamesporo18`).
- `FIREBASE_SERVICE_ACCOUNT_JSON`: complete service-account JSON as one environment-variable value. Keep it private.
- `FIREBASE_ADMIN_UIDS`: comma-separated Firebase Authentication UIDs allowed to review deposits.
- `MIN_DEPOSIT_ETB`: optional, default 10.
- `MAX_DEPOSIT_ETB`: optional, default 100000.
- `TELEBIRR_ACCOUNT_NAME`: optional display value for the receiving account.
- `TELEBIRR_ACCOUNT_NUMBER`: optional display value for the receiving account.
- `TELEBIRR_DEPOSIT_INSTRUCTIONS`: optional customer instructions.

The service account must belong to the same Firebase project and have permission to access Authentication and Cloud Firestore. Enable Email/Password or the sign-in provider used by the frontend in Firebase Authentication, and create the Firestore database.

## Deposit flow currently implemented

1. A signed-in user submits an amount and Telebirr transaction reference.
2. The request is stored as `PENDING`; no balance is credited at submission.
3. An authenticated UID listed in `FIREBASE_ADMIN_UIDS` reviews it.
4. Approval updates the wallet and writes a ledger entry in one Firestore transaction. Repeated approval is rejected.
5. Rejected requests do not change the wallet.

**Important:** this is manual admin verification, not automatic confirmation from Telebirr. The admin must verify the payment in the official Telebirr merchant/account channel before approving. No Telebirr API integration is claimed until official API access and credentials are supplied.

## API authentication

All `/api/wallet` endpoints require `Authorization: Bearer <Firebase ID token>`. The server verifies the token with Firebase Admin. The admin endpoints additionally check the verified UID against `FIREBASE_ADMIN_UIDS`.

## Remaining integration before production

The six game engines currently contain synchronous in-memory balance managers. They must be migrated to asynchronous Firestore-backed debit/settlement operations before real-money play is enabled. Do not expose the current game endpoints for real-money use until that migration and concurrency/idempotency tests are complete. Configure Firestore Security Rules to deny client writes to wallet, depositRequests, and transactions; all monetary writes must go through the server.
