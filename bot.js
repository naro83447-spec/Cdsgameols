'use strict';

// Telegram onboarding worker. Users must send /start before receiving the Mini App button.
// This worker is deployed separately from the web service to avoid duplicate polling.
const crypto = require('crypto');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MINI_APP_URL = process.env.MINI_APP_URL;
const FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

if (!BOT_TOKEN) throw new Error('Missing TELEGRAM_BOT_TOKEN');
if (!MINI_APP_URL || !/^https:\/\/.+/i.test(MINI_APP_URL)) {
  throw new Error('MINI_APP_URL must be the deployed HTTPS Mini App URL');
}
if (!FIREBASE_SERVICE_ACCOUNT_JSON) {
  throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON');
}

const admin = require('firebase-admin');
const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON);
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

async function telegram(method, payload = {}) {
  const response = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description || 'unknown error'}`);
  return data.result;
}

async function registerTelegramUser(user) {
  const id = String(user.id);
  const ref = db.collection('telegramUsers').doc(id);
  const snap = await ref.get();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const profile = {
    telegramId: id,
    firstName: String(user.first_name || '').slice(0, 64),
    lastName: String(user.last_name || '').slice(0, 64),
    username: String(user.username || '').slice(0, 64),
    languageCode: String(user.language_code || '').slice(0, 12),
    isBot: Boolean(user.is_bot),
    registered: true,
    updatedAt: now
  };
  if (!snap.exists) profile.createdAt = now;
  await ref.set(profile, { merge: true });
  return { isNew: !snap.exists, profile };
}

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.from || !msg.text) return;
  const text = msg.text.trim();
  if (!/^\/start(?:@\w+)?(?:\s|$)/i.test(text)) return;

  if (msg.from.is_bot) return;
  const { isNew } = await registerTelegramUser(msg.from);
  const greeting = isNew
    ? `ሰላም ${msg.from.first_name || ''}! በLite Games ተመዝግበሃል።`
    : `እንኳን ደህና መጣህ ${msg.from.first_name || ''}! መለያህ ተረጋግጧል።`;

  await telegram('sendMessage', {
    chat_id: msg.chat.id,
    text: `${greeting}\n\nMini App ለመክፈት ከታች ያለውን ቁልፍ ተጫን።`,
    reply_markup: {
      inline_keyboard: [[{
        text: '🎮 Open Lite Games',
        web_app: { url: MINI_APP_URL }
      }]]
    }
  });
}

async function main() {
  console.log('Lite Games Telegram bot worker starting (long polling)');
  let offset = 0;
  let backoffMs = 1000;
  while (true) {
    try {
      const updates = await telegram('getUpdates', {
        offset,
        timeout: 50,
        allowed_updates: ['message']
      });
      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        try { await handleUpdate(update); }
        catch (err) { console.error('Update handler error:', err.message); }
      }
      backoffMs = 1000;
    } catch (err) {
      console.error('Polling error:', err.message);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      backoffMs = Math.min(backoffMs * 2, 30000);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
