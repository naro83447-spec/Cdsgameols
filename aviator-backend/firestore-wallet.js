'use strict';

const crypto = require('crypto');
const admin = require('firebase-admin');
const { getDb } = require('../shared/firebase-admin');

const money = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('Invalid ETB amount.');
  return Math.round(n * 100) / 100;
};
const requireUid = (uid) => {
  const value = String(uid || '').trim();
  if (!value || value.length > 128 || value.includes('/')) throw new Error('Authenticated Firebase UID required.');
  return value;
};
const idFor = (...parts) => crypto.createHash('sha256').update(parts.join(':')).digest('hex');
const walletRef = (uid) => getDb().collection('users').doc(requireUid(uid)).collection('private').doc('wallet');
const roundRef = (roundId) => getDb().collection('aviatorRounds').doc(String(roundId));
const betRef = (roundId, uid, panelId) => getDb().collection('aviatorBets').doc(idFor(roundId, requireUid(uid), panelId));
const ledgerRef = (uid, opId) => getDb().collection('users').doc(requireUid(uid)).collection('transactions').doc(opId);
const stamp = () => admin.firestore.FieldValue.serverTimestamp();
const conflict = (message) => { const e = new Error(message); e.status = 409; return e; };
const badRequest = (message) => { const e = new Error(message); e.status = 400; return e; };

async function ensureWallet(uid) {
  const ref = walletRef(uid);
  await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) tx.create(ref, { balance: 0, currency: 'ETB', updatedAt: stamp() });
  });
  const snap = await ref.get();
  return { balance: money((snap.data() || {}).balance || 0), currency: 'ETB' };
}

async function createRound({ roundId, serverSeedHash }) {
  const id = String(roundId || '').trim();
  if (!id || id.length > 128 || !serverSeedHash) throw badRequest('roundId and serverSeedHash are required.');
  const ref = roundRef(id);
  await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) throw conflict('Round ID already exists.');
    tx.create(ref, {
      roundId: id,
      status: 'WAITING',
      serverSeedHash: String(serverSeedHash),
      createdAt: stamp(),
      flightStartedAt: null,
      crashedAt: null,
      crashPoint: null,
      fairnessProof: null
    });
  });
  return { roundId: id, status: 'WAITING' };
}

async function startRound(roundId) {
  const ref = roundRef(roundId);
  await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().status !== 'WAITING') throw conflict('Round is not waiting.');
    tx.update(ref, { status: 'FLYING', flightStartedAt: stamp() });
  });
}

async function crashRound({ roundId, crashPoint, fairnessProof }) {
  const point = Number(crashPoint);
  if (!Number.isFinite(point) || point < 1) throw badRequest('Invalid crash point.');
  const ref = roundRef(roundId);
  await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().status !== 'FLYING') throw conflict('Round is not flying.');
    tx.update(ref, { status: 'CRASHED', crashPoint: point, fairnessProof: fairnessProof || null, crashedAt: stamp() });
  });
}

async function placeBet({ uid, roundId, panelId = 1, amount, idempotencyKey }) {
  const player = requireUid(uid);
  const panel = Number(panelId) === 2 ? 2 : Number(panelId) === 1 ? 1 : 0;
  const stake = money(amount);
  if (!panel || stake < 1 || stake > 10000) throw badRequest('Bet must be between 1 and 10000 ETB on panel 1 or 2.');
  const key = String(idempotencyKey || '').trim();
  if (key.length < 8 || key.length > 128) throw badRequest('A valid idempotency key is required.');
  const id = String(roundId);
  const wRef = walletRef(player);
  const rRef = roundRef(id);
  const bRef = betRef(id, player, panel);
  const lRef = ledgerRef(player, 'aviator_bet_' + idFor(key));
  return getDb().runTransaction(async (tx) => {
    const [w, r, b, l] = await Promise.all([tx.get(wRef), tx.get(rRef), tx.get(bRef), tx.get(lRef)]);
    if (b.exists || l.exists) {
      if (b.exists && b.data().uid === player && b.data().idempotencyKey === key && b.data().status === 'PLACED') {
        return { ok: true, idempotent: true, betId: bRef.id, balance: money((w.data() || {}).balance || 0) };
      }
      throw conflict('A bet already exists for this round and panel, or the idempotency key was used.');
    }
    if (!r.exists || r.data().status !== 'WAITING') throw conflict('Bets are accepted only while the round is waiting.');
    const balance = money((w.data() || {}).balance || 0);
    if (balance < stake) throw badRequest('Insufficient available balance.');
    const next = money(balance - stake);
    tx.set(wRef, { balance: next, currency: 'ETB', updatedAt: stamp() }, { merge: true });
    tx.create(bRef, {
      uid: player, roundId: id, panelId: panel, amount: stake, status: 'PLACED',
      idempotencyKey: key, createdAt: stamp(), settledAt: null, multiplier: null, payout: 0
    });
    tx.create(lRef, { uid: player, type: 'AVIATOR_BET', amount: -stake, balanceAfter: next, currency: 'ETB', roundId: id, betId: bRef.id, createdAt: stamp() });
    return { ok: true, betId: bRef.id, balance: next };
  });
}

async function cancelBet({ uid, roundId, panelId = 1 }) {
  const player = requireUid(uid);
  const id = String(roundId);
  const panel = Number(panelId) === 2 ? 2 : 1;
  const wRef = walletRef(player), rRef = roundRef(id), bRef = betRef(id, player, panel);
  const lRef = ledgerRef(player, 'aviator_refund_' + idFor(id, player, panel));
  return getDb().runTransaction(async (tx) => {
    const [w, r, b, l] = await Promise.all([tx.get(wRef), tx.get(rRef), tx.get(bRef), tx.get(lRef)]);
    if (l.exists) return { ok: true, idempotent: true, balance: money((w.data() || {}).balance || 0) };
    if (!r.exists || r.data().status !== 'WAITING' || !b.exists || b.data().status !== 'PLACED') throw conflict('Only an active bet in a waiting round can be cancelled.');
    const amount = money(b.data().amount);
    const next = money(((w.data() || {}).balance || 0) + amount);
    tx.set(wRef, { balance: next, currency: 'ETB', updatedAt: stamp() }, { merge: true });
    tx.update(bRef, { status: 'CANCELLED', settledAt: stamp() });
    tx.create(lRef, { uid: player, type: 'AVIATOR_REFUND', amount, balanceAfter: next, currency: 'ETB', roundId: id, betId: bRef.id, createdAt: stamp() });
    return { ok: true, balance: next };
  });
}

async function cashOut({ uid, roundId, panelId = 1, multiplier }) {
  const player = requireUid(uid);
  const id = String(roundId);
  const panel = Number(panelId) === 2 ? 2 : 1;
  const mult = money(multiplier);
  if (mult < 1.01 || mult > 100000) throw badRequest('Invalid cash-out multiplier.');
  const wRef = walletRef(player), rRef = roundRef(id), bRef = betRef(id, player, panel);
  const lRef = ledgerRef(player, 'aviator_cashout_' + idFor(id, player, panel));
  return getDb().runTransaction(async (tx) => {
    const [w, r, b, l] = await Promise.all([tx.get(wRef), tx.get(rRef), tx.get(bRef), tx.get(lRef)]);
    if (l.exists) return { ok: true, idempotent: true, balance: money((w.data() || {}).balance || 0) };
    if (!r.exists || r.data().status !== 'FLYING' || !b.exists || b.data().status !== 'PLACED') throw conflict('Cash-out is not available for this bet.');
    const stake = money(b.data().amount);
    const payout = money(stake * mult);
    const next = money(((w.data() || {}).balance || 0) + payout);
    tx.set(wRef, { balance: next, currency: 'ETB', updatedAt: stamp() }, { merge: true });
    tx.update(bRef, { status: 'CASHED_OUT', multiplier: mult, payout, settledAt: stamp() });
    tx.create(lRef, { uid: player, type: 'AVIATOR_CASHOUT', amount: payout, balanceAfter: next, currency: 'ETB', roundId: id, betId: bRef.id, multiplier: mult, createdAt: stamp() });
    return { ok: true, balance: next, payout, multiplier: mult };
  });
}

async function settleLoss({ uid, roundId, panelId = 1 }) {
  const player = requireUid(uid);
  const id = String(roundId);
  const panel = Number(panelId) === 2 ? 2 : 1;
  const rRef = roundRef(id), bRef = betRef(id, player, panel);
  const lRef = ledgerRef(player, 'aviator_loss_' + idFor(id, player, panel));
  return getDb().runTransaction(async (tx) => {
    const [r, b, l] = await Promise.all([tx.get(rRef), tx.get(bRef), tx.get(lRef)]);
    if (l.exists) return { ok: true, idempotent: true };
    if (!r.exists || r.data().status !== 'CRASHED' || !b.exists || b.data().status !== 'PLACED') throw conflict('Only an unsettled bet from a crashed round can be marked lost.');
    tx.update(bRef, { status: 'LOST', settledAt: stamp() });
    tx.create(lRef, { uid: player, type: 'AVIATOR_LOSS', amount: 0, balanceAfter: null, currency: 'ETB', roundId: id, betId: bRef.id, crashPoint: r.data().crashPoint, createdAt: stamp() });
    return { ok: true };
  });
}

async function getBetHistory(uid, limit = 50) {
  const player = requireUid(uid);
  const snap = await getDb().collection('aviatorBets').where('uid', '==', player).orderBy('createdAt', 'desc').limit(Math.min(100, Math.max(1, Number(limit) || 50))).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

module.exports = { ensureWallet, createRound, startRound, crashRound, placeBet, cancelBet, cashOut, settleLoss, getBetHistory };
