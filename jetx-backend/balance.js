const { sharedWallet, DEFAULT_BALANCE: UNIFIED_DEFAULT_BALANCE } = require('../shared/wallet');
const DEFAULT_BALANCE = Number(process.env.JETX_DEFAULT_BALANCE_ETB || UNIFIED_DEFAULT_BALANCE || 1000.00);
const MIN_BET = Math.max(1, Number(process.env.JETX_MIN_BET_ETB || 1));
const MAX_BET = Math.max(MIN_BET, Number(process.env.JETX_MAX_BET_ETB || 10000));

function roundMoney(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function formatDisplayUser(playerId, displayName = '') {
  const clean = String(displayName || playerId || '').trim();
  if (clean) return clean.slice(0, 18);
  return `user_${Math.floor(1000 + Math.random() * 8999)}`;
}

class JetXBalanceManager {
  constructor() {
    this.accounts = new Map();
    this.processedOps = new Set();
  }

  ensureAccount(playerId, { displayName = '' } = {}) {
    const uid = String(playerId || '').trim() || `user_${Date.now()}`;
    sharedWallet.ensurePlayer(uid, displayName);
    let acc = this.accounts.get(uid);
    if (!acc) {
      acc = {
        playerId: uid,
        displayName: formatDisplayUser(uid, displayName || uid),
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
    } else if (displayName) {
      acc.displayName = formatDisplayUser(uid, displayName);
    }
    return acc;
  }

  getBalance(playerId) {
    return this.ensureAccount(playerId).balance;
  }

  debitBet({ playerId, amount, roundId, ledgerKey }) {
    const acc = this.ensureAccount(playerId);
    const bet = roundMoney(amount);

    if (!Number.isFinite(bet) || bet < MIN_BET || bet > MAX_BET) {
      return {
        ok: false,
        error: `Bet must be between ${MIN_BET.toFixed(2)} and ${MAX_BET.toFixed(2)} ETB`,
        balance: acc.balance
      };
    }

    const opId = `debit:${ledgerKey}`;
    if (this.processedOps.has(opId)) {
      return { ok: true, idempotent: true, balance: acc.balance, bet };
    }

    if (acc.balance < bet) {
      return { ok: false, error: 'Insufficient balance!', balance: acc.balance };
    }

    acc.balance = roundMoney(acc.balance - bet);
    acc.updatedAt = Date.now();
    acc.transactions.unshift({
      id: opId,
      type: 'BET',
      roundId,
      ledgerKey,
      amount: -bet,
      balanceAfter: acc.balance,
      createdAt: acc.updatedAt
    });
    if (acc.transactions.length > 200) acc.transactions.length = 200;

    this.processedOps.add(opId);
    sharedWallet.recordBetActivity(acc.playerId, { game: 'JetX', type: 'BET', bet, roundId });
    return { ok: true, balance: acc.balance, bet, account: acc };
  }

  refundBet({ playerId, amount, roundId, ledgerKey }) {
    const acc = this.ensureAccount(playerId);
    const bet = roundMoney(amount);
    const opId = `refund:${ledgerKey}`;
    if (this.processedOps.has(opId)) {
      return { ok: true, idempotent: true, balance: acc.balance };
    }

    acc.balance = roundMoney(acc.balance + bet);
    acc.updatedAt = Date.now();
    acc.transactions.unshift({
      id: opId,
      type: 'REFUND',
      roundId,
      ledgerKey,
      amount: bet,
      balanceAfter: acc.balance,
      createdAt: acc.updatedAt
    });
    if (acc.transactions.length > 200) acc.transactions.length = 200;

    this.processedOps.add(opId);
    return { ok: true, balance: acc.balance };
  }

  creditCashOut({ playerId, amount, multiplier, roundId, ledgerKey }) {
    const acc = this.ensureAccount(playerId);
    const bet = roundMoney(amount);
    const mult = roundMoney(multiplier);
    const winAmount = roundMoney(bet * mult);
    const opId = `cashout:${ledgerKey}`;

    if (this.processedOps.has(opId)) {
      return { ok: true, idempotent: true, balance: acc.balance, winAmount, mult };
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
      ledgerKey,
      amount: winAmount,
      multiplier: mult,
      balanceAfter: acc.balance,
      createdAt: acc.updatedAt
    });
    if (acc.transactions.length > 200) acc.transactions.length = 200;

    this.processedOps.add(opId);
    sharedWallet.recordBetActivity(acc.playerId, { game: 'JetX', type: 'WIN', win: winAmount, bet, roundId });
    if (winAmount >= 10) {
      sharedWallet.recordTopWin({
        game: 'JetX',
        badge: `x${mult}`,
        badgeColor: 'indigo',
        user: acc.displayName,
        playerId: acc.playerId,
        bet,
        win: winAmount,
        mult,
        roundId
      });
    }
    return { ok: true, balance: acc.balance, winAmount, mult };
  }

  recordLoss({ playerId, amount, crashMultiplier, roundId, ledgerKey }) {
    const acc = this.ensureAccount(playerId);
    const opId = `loss:${ledgerKey}`;
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

  addBonusBalance(playerId, amount = 500) {
    const acc = this.ensureAccount(playerId);
    const credit = roundMoney(Math.min(50000, Math.max(1, Number(amount) || 500)));
    acc.balance = roundMoney(acc.balance + credit);
    acc.updatedAt = Date.now();
    return { ok: true, balance: acc.balance, added: credit };
  }

  getBetHistory(playerId, limit = 50) {
    return this.ensureAccount(playerId).betHistory.slice(0, limit);
  }
}

module.exports = {
  JetXBalanceManager,
  DEFAULT_BALANCE,
  MIN_BET,
  MAX_BET,
  roundMoney
};
