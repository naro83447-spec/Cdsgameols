'use strict';

const admin = require('firebase-admin');

let app;
function getFirebaseApp() {
  if (app) return app;
  if (admin.apps.length) {
    app = admin.app();
    return app;
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  let credential;
  if (raw) {
    const parsed = JSON.parse(raw);
    credential = admin.credential.cert(parsed);
  } else if (encoded) {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    credential = admin.credential.cert(parsed);
  } else {
    throw new Error('Firebase is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_BASE64 in the hosting environment.');
  }

  app = admin.initializeApp({
    credential,
    projectId: process.env.FIREBASE_PROJECT_ID || undefined
  });
  return app;
}

function getAuth() {
  return getFirebaseApp() && admin.auth();
}
function getDb() {
  return getFirebaseApp() && admin.firestore();
}

async function requireFirebaseUser(req, res, next) {
  try {
    const header = String(req.get('Authorization') || '');
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ status: 'error', message: 'Firebase sign-in required.' });
    const decoded = await getAuth().verifyIdToken(match[1], true);
    req.user = decoded;
    return next();
  } catch (_error) {
    return res.status(401).json({ status: 'error', message: 'Invalid or expired sign-in. Please sign in again.' });
  }
}

function requireAdmin(req, res, next) {
  const allowed = String(process.env.FIREBASE_ADMIN_UIDS || '')
    .split(',').map((v) => v.trim()).filter(Boolean);
  if (!allowed.length) {
    return res.status(503).json({ status: 'error', message: 'Admin access is not configured yet.' });
  }
  if (!req.user || !allowed.includes(req.user.uid)) {
    return res.status(403).json({ status: 'error', message: 'Admin access denied.' });
  }
  return next();
}

module.exports = { getAuth, getDb, requireFirebaseUser, requireAdmin };
