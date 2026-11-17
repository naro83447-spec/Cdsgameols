const { sharedWallet, DEFAULT_BALANCE: UNIFIED_DEFAULT_BALANCE } = require('../shared/wallet');
const DEFAULT_CREDIT = Number(process.env.DRAGONS_DEFAULT_CREDIT_ETB || UNIFIED_DEFAULT_BALANCE || 1000.00);
const MIN_BET = Math.max(1, Number(process.env.DRAGONS_MIN_BET_ETB || 1));
const MAX_BET = Math.max(MIN_BET, Number(process.env.DRAGONS_MAX_BET_ETB || 500));

function roundMoney(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

class DragonsBalanceManager {
  constructor() {
    this.accounts = new Map();
    this.processedSpins = new Set();
  }

  ensureAccount(playerId, displayName = '') {
    const uid = String(playerId || '').trim() || `dragon_${Date.now()}`;
    sharedWallet.ensurePlayer(uid, displayName);
    let acc = this.accounts.get(uid);
    if (!acc) {
      acc = {
        playerId: uid,
        displayName: String(displayName || uid).slice(0, 20),
        get credit() {
          return sharedWallet.getBalance(uid);
        },
        set credit(v) {
          sharedWallet.setBalance(uid, v);
        },
        totalWagered: 0,
        totalWon: 0,
        spinsCount: 0,
        spinHistory: [],
        updatedAt: Date.now()
      };
      this.accounts.set(uid, acc);
    } else if (displayName) {
      acc.displayName = String(displayName).slice(0, 20);
    }
    return acc;
  }

  getCredit(playerId) {
    return this.ensureAccount(playerId).credit;
  }

  addBonusCredit(playerId, amount = 500) {
    const acc = this.ensureAccount(playerId);
    const credit = roundMoney(Math.min(50000, Math.max(1, Number(amount) || 500)));
    acc.credit = roundMoney(acc.credit + credit);
    acc.updatedAt = Date.now();
    return { ok: true, credit: acc.credit, added: credit };
  }

  settleSpin({ playerId, spinId, bet, winAmount, middleRow, winType, multiplier }) {
    const acc = this.ensureAccount(playerId);
    const stake = roundMoney(bet);

    if (!Number.isFinite(stake) || stake < MIN_BET || stake > MAX_BET) {
      return {
        ok: false,
        code: 'INVALID_BET',
        error: `Bet must be between ETB ${MIN_BET.toFixed(2)} and ETB ${MAX_BET.toFixed(2)}`,
        credit: acc.credit
      };
    }

    if (spinId && this.processedSpins.has(spinId)) {
      return { ok: true, idempotent: true, credit: acc.credit };
    }

    if (acc.credit < stake) {
      return {
        ok: false,
        code: 'INSUFFICIENT_FUNDS',
        error: 'Insufficient funds to place this bet.',
        credit: acc.credit
      };
    }

    const payout = roundMoney(winAmount);
    acc.credit = roundMoney(acc.credit - stake + payout);
    acc.totalWagered = roundMoney(acc.totalWagered + stake);
    acc.totalWon = roundMoney(acc.totalWon + payout);
    acc.spinsCount += 1;
    acc.updatedAt = Date.now();

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    acc.spinHistory.unshift({
      spinId,
      time: timeStr,
      bet: stake,
      middleRow,
      winType,
      multiplier,
      win: payout,
      creditAfter: acc.credit
    });
    if (acc.spinHistory.length > 60) acc.spinHistory.length = 60;

    if (spinId) this.processedSpins.add(spinId);
    sharedWallet.recordBetActivity(acc.playerId, {
      game: '888 Dragons',
      type: 'SPIN',
      bet: stake,
      win: payout,
      roundId: spinId
    });
    if (payout >= 10) {
      sharedWallet.recordTopWin({
        game: '888 Dragons',
        badge: multiplier ? `x${multiplier}` : 'WIN',
        badgeColor: 'amber',
        user: acc.displayName,
        playerId: acc.playerId,
        bet: stake,
        win: payout,
        mult: multiplier || 1,
        roundId: spinId
      });
    }
    return {
      ok: true,
      credit: acc.credit,
      totalWagered: acc.totalWagered,
      totalWon: acc.totalWon,
      spinsCount: acc.spinsCount
    };
  }

  getHistory(playerId, limit = 30) {
    return this.ensureAccount(playerId).spinHistory.slice(0, limit);
  }
}

module.exports = {
  DragonsBalanceManager,
  DEFAULT_CREDIT,
  MIN_BET,
  MAX_BET,
  roundMoney
};
