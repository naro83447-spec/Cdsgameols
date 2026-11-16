# Lite Games Platform — Telegram onboarding bundle

This bundle contains the original six-game Node/Express project plus a Telegram `/start` onboarding worker.

## Telegram onboarding flow

1. A user opens the Telegram bot and sends `/start`.
2. The bot creates/updates `telegramUsers/{telegramId}` in Firestore.
3. The bot replies with an **Open Lite Games** Telegram Mini App button.
4. The button opens the HTTPS URL configured in `MINI_APP_URL`.

The bot uses Telegram long polling. Run **one bot worker only** for a given bot token; multiple workers can cause Telegram `409 Conflict` errors.

## Render setup

Create two services from this repository:

### Web service
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health path: `/health`

### Background worker
- Runtime: Node
- Build command: `npm install`
- Start command: `npm run start:bot`

Set these secrets/environment values on the worker:
- `TELEGRAM_BOT_TOKEN`: token from BotFather
- `MINI_APP_URL`: deployed web service HTTPS URL
- `FIREBASE_SERVICE_ACCOUNT_JSON`: full Firebase service-account JSON on one line

`render.yaml` is a starter Blueprint. Review the worker plan and any charges before applying it. If you need a free worker, check current Render plan availability; do not assume a continuously running worker is free.

## Firebase setup

1. Create/select a Firebase project.
2. Enable Cloud Firestore.
3. Create a service account with only the access needed by this app.
4. Put its JSON in Render's `FIREBASE_SERVICE_ACCOUNT_JSON` secret.
5. Never commit the service-account JSON or private key to GitHub.

The bot writes user registration documents to `telegramUsers`.

## Important security and deployment limitations

This is an onboarding integration, **not a production-ready identity/security migration**. The original game and wallet APIs still accept client-supplied player IDs. Merely hiding the Mini App button until `/start` does not secure those APIs. Before any public launch, implement Telegram `initData` signature verification and enforce server-side authenticated identity on every wallet and game route.

The supplied project has in-memory game/wallet state and demo balance/deposit behavior. It is not safe for real-money deposits, withdrawals, or wagering. Do not connect real payment rails or accept real funds until the wallet is replaced with a persistent, transaction-safe database implementation, all balance-changing routes are authenticated/authorized, payment webhooks are verified, and the product has been reviewed for applicable legal requirements.

## Existing environment variables

The game engines read the optional variables listed in the earlier deployment guide. Render supplies `PORT` automatically. Most game settings have code defaults and do not need to be added unless you want to override them.

## Local run

```bash
npm install
npm start
```

Run the bot in a separate terminal after setting its three required environment variables:

```bash
npm run start:bot
```
