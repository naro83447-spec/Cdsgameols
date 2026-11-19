'use strict';

const admin = require('firebase-admin');
const crypto = require('crypto');
const { getDb } = require('./firebase-admin');

const MIN_DEPOSIT = Number(process.env.MIN_DEPOSIT_ETB || 10);
const MAX_DEPOSIT = Number(process.env.MAX_DEPOSIT_ETB || 100000);
const money = (v) => { const n = Number(v); if (!Number.isFinite(n)) throw new Error('Invalid money amount.'); return Math.round(n * 100) / 100; };
const userRef = (uid) => getDb().collection('users').doc(uid);
const walletRef = (uid) => userRef(uid).collection('private').doc('wallet');
const referenceId = (uid, ref) => crypto.createHash('sha256').update(uid + ':' + ref.trim().toLowerCase()).digest('hex');
const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

async function getWallet(uid) {
  const ref = walletRef(uid);
  await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) tx.create(ref, { balance: 0, currency: 'ETB', updatedAt: serverTimestamp() });
  });
  const snap = await ref.get();
  return { balance: money((snap.data() || {}).balance || 0), currency: 'ETB' };
}
async function createDepositRequest(uid, input) {
  const amount = money(input.amount);
  const reference = String(input.telebirrReference || '').trim();
  if (amount < MIN_DEPOSIT || amount > MAX_DEPOSIT) { const e = new Error(`Deposit must be between ${MIN_DEPOSIT} and ${MAX_DEPOSIT} ETB.`); e.status = 400; throw e; }
  if (reference.length < 5 || reference.length > 100 || !/^[a-zA-Z0-9._/-]+$/.test(reference)) { const e = new Error('Enter the Telebirr transaction reference exactly as shown on your receipt.'); e.status = 400; throw e; }
  const id = referenceId(uid, reference);
  const globalReferenceId = crypto.createHash('sha256').update(reference.trim().toLowerCase()).digest('hex');
  const ref = userRef(uid).collection('depositRequests').doc(id);
  const globalReferenceRef = getDb().collection('telebirrReferences').doc(globalReferenceId);
  await getDb().runTransaction(async (tx) => {
    const [existing, globalReference] = await Promise.all([tx.get(ref), tx.get(globalReferenceRef)]);
    if (existing.exists || globalReference.exists) { const e = new Error('This Telebirr reference has already been submitted.'); e.status = 409; throw e; }
    tx.create(ref, { uid, amount, currency: 'ETB', method: 'TELEBIRR', telebirrReference: reference, status: 'PENDING', createdAt: serverTimestamp(), reviewedAt: null, reviewedBy: null });
    tx.create(globalReferenceRef, { uid, requestId: id, createdAt: serverTimestamp() });
  });
  return { requestId: id, amount, status: 'PENDING' };
}
async function listPendingDeposits(limit = 100) {
  const snap = await getDb().collectionGroup('depositRequests').where('status', '==', 'PENDING').orderBy('createdAt', 'asc').limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
async function reviewDeposit(uid, requestId, decision, adminUid, note = '') {
  const db = getDb();
  const reqRef = userRef(uid).collection('depositRequests').doc(requestId);
  const balRef = walletRef(uid);
  const ledgerRef = userRef(uid).collection('transactions').doc('deposit_' + requestId);
  return db.runTransaction(async (tx) => {
    const [r, b, l] = await Promise.all([tx.get(reqRef), tx.get(balRef), tx.get(ledgerRef)]);
    if (!r.exists) { const e = new Error('Deposit request not found.'); e.status = 404; throw e; }
    if (r.data().status !== 'PENDING') { const e = new Error('This request has already been reviewed.'); e.status = 409; throw e; }
    const now = serverTimestamp();
    if (decision === 'APPROVE') {
      if (l.exists) { const e = new Error('Ledger entry already exists.'); e.status = 409; throw e; }
      const amount = money(r.data().amount);
      const next = money(((b.data() || {}).balance || 0) + amount);
      tx.set(balRef, { balance: next, currency: 'ETB', updatedAt: now }, { merge: true });
      tx.create(ledgerRef, { uid, type: 'DEPOSIT', method: 'TELEBIRR', amount, currency: 'ETB', balanceAfter: next, reference: r.data().telebirrReference, requestId, createdAt: now, approvedBy: adminUid });
    }
    tx.update(reqRef, { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', reviewedAt: now, reviewedBy: adminUid, adminNote: String(note).slice(0, 500) });
    return { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED' };
  });
}
async function getTransactions(uid, limit = 50) {
  const snap = await userRef(uid).collection('transactions').orderBy('createdAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
module.exports = { getWallet, createDepositRequest, listPendingDeposits, reviewDeposit, getTransactions, MIN_DEPOSIT, MAX_DEPOSIT };
