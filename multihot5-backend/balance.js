const { roundMoney } = require('./paytable');
const { sharedWallet, DEFAULT_BALANCE: UNIFIED_DEFAULT_BALANCE } = require('../shared/wallet');

const DEFAULT_BALANCE = Number(process.env.MH5_DEFAULT_BALANCE_ETB || UNIFIED_DEFAULT_BALANCE || 1000.00);
const MIN_BET = Math.max(1, Number(process.env.MH5_MIN_BET_ETB || 1));
const MAX_BET = Math.max(MIN_BET, Number(process.env.MH5_MAX_BET_ETB || 5000));
const MAX_GAMBLE_STEPS = 5;

function maskName(playerId, displayName = '') {
  const clean = String(displayName || '').trim();
  if (clean) return clean.slice(0, 18);
  const raw = String(playerId || 'player').replace(/[^a-zA-Z0-9_-]/g, '');
  if (raw.length <= 2) return `${raw[0] || 'p'}***`;
  return `${raw[0]}***${raw[raw.length - 1]}`;
}

class MultiHot5BalanceManager {
  constructor() {
    this.accounts = new Map();
  }

  ensureAccount(playerId, displayName = '') {
    const uid = String(playerId || '').trim() || `mh5_${Date.now()}`;
    sharedWallet.ensurePlayer(uid, displayName);
    let acc = this.accounts.get(uid);
    if (!acc) {
      acc = {
        playerId: uid,
        displayName: maskName(uid, displayName),
        get balance() {
          return sharedWallet.getBalance(uid);
        },
        set balance(v) {
          sharedWallet.setBalance(uid, v);
        },
        pendingGamble: null, // { spinId, bet, currentWin, stepsLeft, cardHistory }
        totalWagered: 0,
        totalWon: 0,
        spinsCount: 0,
        history: [],
        updatedAt: Date.now()
      };
      this.accounts.set(uid, acc);
    } else if (displayName && displayName.trim()) {
      acc.displayName = maskName(uid, displayName);
    }
    return acc;
  }

  collectPendingWin(playerId) {
    const acc = this.ensureAccount(playerId);
    if (!acc.pendingGamble) {
      return { ok: true, collected: 0, balance: acc.balance };
    }

    const amount = roundMoney(acc.pendingGamble.currentWin);
    const spinId = acc.pendingGamble.spinId;
    acc.pendingGamble = null;

    if (amount > 0) {
      acc.balance = roundMoney(acc.balance + amount);
      acc.totalWon = roundMoney(acc.totalWon + amount);

      const entry = acc.history.find((h) => h.spinId === spinId);
      if (entry) {
        entry.win = amount;
        entry.status = 'COLLECTED';
      }

      sharedWallet.recordBetActivity(acc.playerId, { game: 'Multi Hot 5', type: 'WIN', win: amount, roundId: spinId });
      if (amount >= 10) {
        sharedWallet.recordTopWin({
          game: 'Multi Hot 5',
          badge: 'HOT 5',
          badgeColor: 'amber',
          user: acc.displayName,
          playerId: acc.playerId,
          bet: entry ? entry.bet : 0,
          win: amount,
          roundId: spinId
        });
      }
    }

    acc.updatedAt = Date.now();
    return { ok: true, collected: amount, balance: acc.balance };
  }

  recordSpin({ playerId, spinId, bet, winAmount, companionMultiplier, reels, winningLines }) {
    const acc = this.ensureAccount(playerId);
    const stake = roundMoney(bet);
    const win = roundMoney(winAmount);

    if (acc.balance < stake) {
      return { ok: false, error: 'Insufficient balance!', balance: acc.balance };
    }

    acc.balance = roundMoney(acc.balance - stake);
    acc.totalWagered = roundMoney(acc.totalWagered + stake);
    acc.spinsCount += 1;

    // Put win into pendingGamble so player can choose COLLECT or X2 GAMBLE!
    if (win > 0) {
      acc.pendingGamble = {
        spinId,
        bet: stake,
        baseWin: win,
        currentWin: win,
        stepsUsed: 0,
        stepsMax: MAX_GAMBLE_STEPS,
        recentCards: []
      };
    } else {
      acc.pendingGamble = null;
    }

    acc.history.unshift({
      spinId,
      bet: stake,
      win,
      companionMultiplier,
      linesCount: winningLines.length,
      reels,
      status: win > 0 ? 'PENDING_COLLECT' : 'LOST',
      createdAt: Date.now()
    });
    if (acc.history.length > 50) acc.history.length = 50;

    acc.updatedAt = Date.now();
    sharedWallet.recordBetActivity(acc.playerId, { game: 'Multi Hot 5', type: 'BET', bet: stake, roundId: spinId });
    return {
      ok: true,
      balance: acc.balance,
      pendingGamble: acc.pendingGamble
    };
  }

  addBonusCredit(playerId, amount = 500) {
    const acc = this.ensureAccount(playerId);
    const credit = roundMoney(Math.min(50000, Math.max(1, Number(amount) || 500)));
    acc.balance = roundMoney(acc.balance + credit);
    acc.updatedAt = Date.now();
    return { ok: true, balance: acc.balance, added: credit };
  }

  getHistory(playerId, limit = 30) {
    return this.ensureAccount(playerId).history.slice(0, limit);
  }
}

module.exports = {
  MultiHot5BalanceManager,
  DEFAULT_BALANCE,
  MIN_BET,
  MAX_BET,
  MAX_GAMBLE_STEPS
};
