const fs = require('fs');
const path = require('path');

const DEFAULT_BALANCE = 0;

function roundMoney(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function maskPlayerLabel(playerId, displayName = '') {
  const clean = String(displayName || '').trim();
  if (clean) return clean.slice(0, 18);
  const raw = String(playerId || 'player').replace(/[^a-zA-Z0-9_-]/g, '');
  if (raw.length <= 3) return `${raw[0] || 'p'}***`;
  return `${raw.slice(0, 2)}***${raw.slice(-2)}`;
}

class UnifiedWalletStore {
  constructor() {
    this.players = new Map();
    this.transactions = [];
    this.topWinners = [];
  }

  ensurePlayer(playerId, displayName = '') {
    const uid = String(playerId || '').trim() || `lg_${Date.now()}`;
    let p = this.players.get(uid);
    if (!p) {
      p = {
        playerId: uid,
        displayName: maskPlayerLabel(uid, displayName),
        balance: roundMoney(DEFAULT_BALANCE),
        totalWagered: 0,
        totalWon: 0,
        totalDeposited: 0,
        gamesPlayed: 0,
        lastRewardClaimAt: 0,
        transactions: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this.players.set(uid, p);
    } else if (displayName && String(displayName).trim()) {
      p.displayName = maskPlayerLabel(uid, displayName);
    }
    return p;
  }

  getBalance(playerId) {
    return this.ensurePlayer(playerId).balance;
  }

  setBalance(playerId, newBalance) {
    const p = this.ensurePlayer(playerId);
    p.balance = Math.max(0, roundMoney(newBalance));
    p.updatedAt = Date.now();
    return p.balance;
  }

  deposit(playerId, amount = 500, method = 'Telebirr') {
    const p = this.ensurePlayer(playerId);
    const credit = roundMoney(Math.min(100000, Math.max(1, Number(amount) || 0)));
    p.balance = roundMoney(p.balance + credit);
    p.totalDeposited = roundMoney(p.totalDeposited + credit);
    p.updatedAt = Date.now();

    const tx = {
      id: `dep_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      playerId: p.playerId,
      game: 'Lite Games',
      type: 'DEPOSIT',
      method,
      amount: credit,
      balanceAfter: p.balance,
      createdAt: p.updatedAt
    };
    p.transactions.unshift(tx);
    if (p.transactions.length > 100) p.transactions.length = 100;

    return {
      ok: true,
      playerId: p.playerId,
      balance: p.balance,
      added: credit,
      method,
      transaction: tx
    };
  }

  claimReward(playerId, amount = 100) {
    const p = this.ensurePlayer(playerId);
    const cooldownMs = 60 * 60 * 1000; // 1 hour demo cooldown
    const elapsed = Date.now() - (p.lastRewardClaimAt || 0);
    if (p.lastRewardClaimAt && elapsed < cooldownMs) {
      const minsLeft = Math.max(1, Math.ceil((cooldownMs - elapsed) / 60000));
      return {
        ok: false,
        error: `ቀጣዩ ጉርሻ በ ${minsLeft} ደቂቃ ውስጥ ዝግጁ ይሆናል`,
        balance: p.balance,
        nextClaimAt: p.lastRewardClaimAt + cooldownMs
      };
    }

    const bonus = roundMoney(amount);
    p.balance = roundMoney(p.balance + bonus);
    p.lastRewardClaimAt = Date.now();
    p.updatedAt = Date.now();

    p.transactions.unshift({
      id: `rew_${Date.now()}`,
      playerId: p.playerId,
      game: 'Lite Games',
      type: 'REWARD',
      amount: bonus,
      balanceAfter: p.balance,
      createdAt: p.updatedAt
    });
    if (p.transactions.length > 100) p.transactions.length = 100;

    return {
      ok: true,
      playerId: p.playerId,
      balance: p.balance,
      added: bonus
    };
  }

  recordBetActivity(playerId, { game, type = 'BET', amount = 0, bet = 0, win = 0, roundId = '' } = {}) {
    const p = this.ensurePlayer(playerId);
    if (type === 'BET') {
      p.totalWagered = roundMoney(p.totalWagered + (Number(amount || bet) || 0));
      p.gamesPlayed += 1;
    } else if (type === 'WIN') {
      p.totalWon = roundMoney(p.totalWon + (Number(amount || win) || 0));
    } else if (type === 'SPIN') {
      p.totalWagered = roundMoney(p.totalWagered + (Number(bet) || 0));
      p.totalWon = roundMoney(p.totalWon + (Number(win) || 0));
      p.gamesPlayed += 1;
    }
    p.updatedAt = Date.now();

    p.transactions.unshift({
      id: `tx_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      playerId: p.playerId,
      game: game || 'Game',
      type,
      amount: roundMoney(type === 'WIN' ? (amount || win) : -(amount || bet)),
      win: roundMoney(win),
      bet: roundMoney(bet),
      roundId: String(roundId || ''),
      balanceAfter: p.balance,
      createdAt: p.updatedAt
    });
    if (p.transactions.length > 100) p.transactions.length = 100;
  }

  recordTopWin({ game, badge = '', badgeColor = 'cyan', user = '', playerId = '', bet = 0, win = 0, mult = 0, roundId = '' }) {
    const payout = roundMoney(win);
    if (payout <= 0) return;

    const cleanUser = maskPlayerLabel(playerId, user);
    const computedMult = mult > 0 ? roundMoney(mult) : (bet > 0 ? roundMoney(payout / bet) : 1);
    const entry = {
      id: `win_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      game: game || 'Lite Games',
      badge: badge || (computedMult >= 1 ? `x${computedMult}` : 'WIN'),
      badgeColor,
      user: cleanUser,
      bet: roundMoney(bet),
      win: payout,
      mult: computedMult,
      roundId: String(roundId || ''),
      createdAt: Date.now()
    };

    this.topWinners.unshift(entry);
    if (this.topWinners.length > 40) {
      this.topWinners.length = 40;
    }
  }

  getTopWinners(limit = 16) {
    return this.topWinners.slice(0, limit);
  }

  getLeaderboard(limit = 20) {
    const realPlayers = Array.from(this.players.values())
      .filter((p) => p.totalWagered > 0 || p.totalWon > 0)
      .map((p) => ({
        user: p.displayName,
        playerId: p.playerId,
        totalWon: p.totalWon,
        totalWagered: p.totalWagered,
        gamesPlayed: p.gamesPlayed,
        balance: p.balance
      }));

    const combined = [
      ...realPlayers,
      ...this.topWinners.map((w) => ({
        user: w.user,
        game: w.game,
        totalWon: w.win,
        totalWagered: w.bet,
        gamesPlayed: 1,
        badge: w.badge
      }))
    ];

    combined.sort((a, b) => (b.totalWon || 0) - (a.totalWon || 0));
    return combined.slice(0, limit).map((item, idx) => ({
      rank: idx + 1,
      ...item
    }));
  }

  getPlayerState(playerId, displayName = '') {
    const p = this.ensurePlayer(playerId, displayName);
    return {
      playerId: p.playerId,
      displayName: p.displayName,
      balance: p.balance,
      totalWagered: p.totalWagered,
      totalWon: p.totalWon,
      totalDeposited: p.totalDeposited,
      gamesPlayed: p.gamesPlayed,
      transactions: p.transactions.slice(0, 25),
      updatedAt: p.updatedAt
    };
  }
}

// Strict process-wide singleton so Vite TS + CommonJS backends share 1 exact wallet instance
const GLOBAL_KEY = '__LITEGAMES_UNIFIED_WALLET__';
if (!global[GLOBAL_KEY]) {
  global[GLOBAL_KEY] = new UnifiedWalletStore();
}
const sharedWallet = global[GLOBAL_KEY];

module.exports = {
  sharedWallet,
  UnifiedWalletStore,
  DEFAULT_BALANCE,
  roundMoney,
  maskPlayerLabel
};
