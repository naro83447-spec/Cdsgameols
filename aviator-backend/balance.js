const { sharedWallet, DEFAULT_BALANCE: UNIFIED_DEFAULT_BALANCE } = require('../shared/wallet');
const DEFAULT_BALANCE = Number(process.env.AVIATOR_DEFAULT_BALANCE_ETB || UNIFIED_DEFAULT_BALANCE || 1000.00);
const MIN_BET = Math.max(1, Number(process.env.AVIATOR_MIN_BET_ETB || 1));
const MAX_BET = Math.max(MIN_BET, Number(process.env.AVIATOR_MAX_BET_ETB || 10000));

function roundMoney(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function maskName(playerId, displayName = '') {
  const clean = String(displayName || playerId || 'd***u').trim();
  if (clean.includes('***')) return clean;
  if (clean.length <= 2) return `${clean[0] || 'p'}***`;
  return `${clean[0]}***${clean[clean.length - 1]}`;
}

class AviatorBalanceManager {
  constructor() {
    this.accounts = new Map();
    this.processedOps = new Set();
    this.rainClaims = new Map(); // rainId -> Set(playerId)
  }

  ensureAccount(playerId, { displayName = '', avatarSeed = '' } = {}) {
    const uid = String(playerId || '').trim() || `p_${Date.now()}`;
    sharedWallet.ensurePlayer(uid, displayName);
    let acc = this.accounts.get(uid);
    if (!acc) {
      acc = {
        playerId: uid,
        maskedName: maskName(uid, displayName || (uid.startsWith('p_') ? 'd***u' : uid)),
        avatarSeed: avatarSeed || 'MercedesGold',
        get balance() {
          return sharedWallet.getBalance(uid);
        },
        set balance(v) {
          sharedWallet.setBalance(uid, v);
        },
        betHistory: [],
        transactions: [],
        updatedAt: Date.now()
      };
      this.accounts.set(uid, acc);
    } else {
      if (displayName) acc.maskedName = maskName(uid, displayName);
      if (avatarSeed) acc.avatarSeed = avatarSeed;
    }
    return acc;
  }

  getBalance(playerId) {
    return this.ensureAccount(playerId).balance;
  }

  updateAvatar(playerId, avatarSeed) {
    const acc = this.ensureAccount(playerId);
    if (avatarSeed) acc.avatarSeed = String(avatarSeed);
    return acc;
  }

  debitBet({ playerId, amount, roundId, betKey }) {
    const acc = this.ensureAccount(playerId);
    const bet = roundMoney(amount);

    if (!Number.isFinite(bet) || bet < MIN_BET || bet > MAX_BET) {
      return {
        ok: false,
        error: `Bet must be between ${MIN_BET.toFixed(2)} and ${MAX_BET.toFixed(2)} ETB`,
        balance: acc.balance
      };
    }

    const opId = `debit:${betKey}`;
    if (this.processedOps.has(opId)) {
      return { ok: true, idempotent: true, balance: acc.balance, bet };
    }

    if (acc.balance < bet) {
      return { ok: false, error: 'Not enough balance', balance: acc.balance };
    }

    acc.balance = roundMoney(acc.balance - bet);
    acc.updatedAt = Date.now();
    acc.transactions.unshift({
      id: opId,
      type: 'BET',
      roundId,
      betKey,
      amount: -bet,
      balanceAfter: acc.balance,
      createdAt: acc.updatedAt
    });
    if (acc.transactions.length > 200) acc.transactions.length = 200;

    this.processedOps.add(opId);
    sharedWallet.recordBetActivity(acc.playerId, { game: 'Aviator', type: 'BET', bet, roundId });
    return { ok: true, balance: acc.balance, bet, account: acc };
  }

  refundBet({ playerId, amount, roundId, betKey }) {
    const acc = this.ensureAccount(playerId);
    const bet = roundMoney(amount);
    const opId = `refund:${betKey}`;
    if (this.processedOps.has(opId)) {
      return { ok: true, idempotent: true, balance: acc.balance };
    }

    acc.balance = roundMoney(acc.balance + bet);
    acc.updatedAt = Date.now();
    acc.transactions.unshift({
      id: opId,
      type: 'REFUND',
      roundId,
      betKey,
      amount: bet,
      balanceAfter: acc.balance,
      createdAt: acc.updatedAt
    });
    if (acc.transactions.length > 200) acc.transactions.length = 200;

    this.processedOps.add(opId);
    return { ok: true, balance: acc.balance };
  }

  creditCashOut({ playerId, amount, multiplier, roundId, betKey }) {
    const acc = this.ensureAccount(playerId);
    const bet = roundMoney(amount);
    const mult = roundMoney(multiplier);
    const winAmount = roundMoney(bet * mult);
    const opId = `cashout:${betKey}`;

    if (this.processedOps.has(opId)) {
      return { ok: true, idempotent: true, balance: acc.balance, winAmount };
    }

    acc.balance = roundMoney(acc.balance + winAmount);
    acc.updatedAt = Date.now();

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    acc.betHistory.unshift({
      roundId,
      time: timeStr,
      bet,
      mult,
      win: winAmount,
      createdAt: acc.updatedAt
    });
    if (acc.betHistory.length > 100) acc.betHistory.length = 100;

    acc.transactions.unshift({
      id: opId,
      type: 'CASHOUT',
      roundId,
      betKey,
      amount: winAmount,
      multiplier: mult,
      balanceAfter: acc.balance,
      createdAt: acc.updatedAt
    });
    if (acc.transactions.length > 200) acc.transactions.length = 200;

    this.processedOps.add(opId);
    sharedWallet.recordBetActivity(acc.playerId, { game: 'Aviator', type: 'WIN', win: winAmount, bet, roundId });
    if (winAmount >= 10) {
      sharedWallet.recordTopWin({
        game: 'Aviator',
        badge: `x${mult}`,
        badgeColor: 'blue',
        user: acc.maskedName,
        playerId: acc.playerId,
        bet,
        win: winAmount,
        mult,
        roundId
      });
    }
    return { ok: true, balance: acc.balance, winAmount, mult };
  }

  recordLoss({ playerId, amount, crashMultiplier, roundId, betKey }) {
    const acc = this.ensureAccount(playerId);
    const opId = `loss:${betKey}`;
    if (this.processedOps.has(opId)) return;

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    acc.betHistory.unshift({
      roundId,
      time: timeStr,
      bet: roundMoney(amount),
      mult: roundMoney(crashMultiplier),
      win: 0,
      createdAt: Date.now()
    });
    if (acc.betHistory.length > 100) acc.betHistory.length = 100;
    this.processedOps.add(opId);
  }

  topUp(playerId, amount = 100) {
    const acc = this.ensureAccount(playerId);
    const credit = roundMoney(Math.min(50000, Math.max(1, Number(amount) || 100)));
    acc.balance = roundMoney(acc.balance + credit);
    acc.updatedAt = Date.now();
    return { ok: true, balance: acc.balance, added: credit };
  }

  claimRain(playerId, rainId, amount = 20, maxClaims = 25) {
    const acc = this.ensureAccount(playerId);
    if (!this.rainClaims.has(rainId)) {
      this.rainClaims.set(rainId, new Set(['seed_a', 'seed_b', 'seed_c']));
    }
    const claimedSet = this.rainClaims.get(rainId);
    if (claimedSet.has(acc.playerId)) {
      return { ok: false, error: 'You already claimed this Rain bonus!', balance: acc.balance, claimedCount: claimedSet.size, maxClaims };
    }
    if (claimedSet.size >= maxClaims) {
      return { ok: false, error: 'Rain bonus is fully claimed!', balance: acc.balance, claimedCount: claimedSet.size, maxClaims };
    }

    claimedSet.add(acc.playerId);
    const bonus = roundMoney(amount);
    acc.balance = roundMoney(acc.balance + bonus);
    acc.updatedAt = Date.now();

    return {
      ok: true,
      balance: acc.balance,
      added: bonus,
      claimedCount: claimedSet.size,
      maxClaims
    };
  }

  getBetHistory(playerId, limit = 50) {
    return this.ensureAccount(playerId).betHistory.slice(0, limit);
  }
}

module.exports = {
  AviatorBalanceManager,
  DEFAULT_BALANCE,
  MIN_BET,
  MAX_BET,
  roundMoney,
  maskName
};
