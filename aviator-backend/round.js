const crypto = require('crypto');
const { generateRandomSeed, sha256 } = require('./fairness');
const { roundMoney } = require('./balance');

const PHASES = {
  WAITING: 'WAITING',
  FLYING: 'FLYING',
  CRASHED: 'CRASHED'
};

const BOT_NAMES = [
  'w***d', 'j***r', 'k***f', 'v***w', 'e***v', 'r***n', 'j***p', 'z***b',
  'd***e', 'p***e', 'b***l', 'l***f', 'k***g', 'a***j', 'y***h', 'g***p',
  'c***j', 'x***j', 'm***k', 's***t', 'n***a', 'f***m', 'o***k', 'e***a'
];

class AviatorRound {
  constructor(roundId, config = {}) {
    this.roundId = Number(roundId);
    this.phase = PHASES.WAITING;

    this.waitDurationMs = Number(config.waitDurationMs || 5000);
    this.crashPauseMs = Number(config.crashPauseMs || 3000);

    this.startedAt = Date.now();
    this.waitEndsAt = this.startedAt + this.waitDurationMs;
    this.flightStartedAt = 0;
    this.crashedAt = 0;
    this.crashEndsAt = 0;

    this.multiplier = 1.00;
    this.serverSeed = generateRandomSeed(16);
    this.serverSeedHash = sha256(this.serverSeed);
    this.crashPoint = null;
    this.fairnessProof = null;

    this.bets = new Map(); // betKey -> betObj
    this.botBets = this._createSimulatedBets();
    this.basePlayersCount = 435;
  }

  _createSimulatedBets() {
    const count = 24;
    const list = [];
    const stakes = [4, 10, 20, 50, 100, 250, 300, 464, 700, 1004, 1476, 2504];
    for (let i = 0; i < count; i++) {
      const name = BOT_NAMES[i % BOT_NAMES.length];
      const bet = stakes[Math.floor(Math.random() * stakes.length)];
      const targetCashout = Math.random() < 0.72
        ? roundMoney(1.12 + Math.random() * 4.5)
        : 9999;

      list.push({
        betKey: `bot_${this.roundId}_${i}`,
        name,
        avatarSeed: `${name}${i}`,
        bet,
        targetCashout,
        cashedOut: false,
        cashMult: null,
        winAmount: 0,
        isMe: false,
        isBot: true
      });
    }
    list.sort((a, b) => b.bet - a.bet);
    return list;
  }

  getWaitTimeLeftMs(now = Date.now()) {
    return Math.max(0, this.waitEndsAt - now);
  }

  addRealBet({ playerId, panelId, maskedName, avatarSeed, amount, autoCashOut = null, clientSeed = '', ledgerKey = '' }) {
    if (this.phase !== PHASES.WAITING) {
      return { ok: false, error: 'Wait for next round to place bet' };
    }

    const betKey = `${this.roundId}:${playerId}:${panelId}`;
    if (this.bets.has(betKey)) {
      return { ok: false, error: 'Bet already placed on this panel for this round' };
    }

    const betObj = {
      betKey,
      ledgerKey: ledgerKey || betKey,
      roundId: this.roundId,
      playerId: String(playerId),
      panelId: Number(panelId),
      name: maskedName,
      avatarSeed: avatarSeed || 'MercedesGold',
      bet: roundMoney(amount),
      autoCashOut: autoCashOut && Number(autoCashOut) >= 1.01 ? roundMoney(autoCashOut) : null,
      clientSeed: clientSeed || crypto.randomBytes(10).toString('hex'),
      status: 'PLACED', // 'PLACED' | 'CASHED_OUT' | 'LOST'
      cashedOut: false,
      cashMult: null,
      winAmount: 0,
      isBot: false,
      createdAt: Date.now()
    };

    this.bets.set(betKey, betObj);
    return { ok: true, bet: betObj };
  }

  removeRealBet(playerId, panelId) {
    if (this.phase !== PHASES.WAITING) {
      return { ok: false, error: 'Cannot cancel bet after takeoff' };
    }
    const betKey = `${this.roundId}:${playerId}:${panelId}`;
    const existing = this.bets.get(betKey);
    if (!existing) {
      return { ok: false, error: 'No active bet to cancel' };
    }
    this.bets.delete(betKey);
    return { ok: true, bet: existing };
  }

  updateAutoCashOut(playerId, panelId, autoCashOut) {
    const betKey = `${this.roundId}:${playerId}:${panelId}`;
    const existing = this.bets.get(betKey);
    if (!existing || existing.status !== 'PLACED') return false;
    existing.autoCashOut = autoCashOut && Number(autoCashOut) >= 1.01 ? roundMoney(autoCashOut) : null;
    return true;
  }

  getTop3ClientSeeds() {
    const real = Array.from(this.bets.values()).slice(0, 3).map((b) => ({
      player: b.name,
      seed: b.clientSeed
    }));
    return real;
  }

  getFeedRows(requestingPlayerId = '') {
    const realRows = Array.from(this.bets.values()).map((b) => ({
      betKey: b.betKey,
      name: b.playerId === String(requestingPlayerId) ? `${b.name} (You)` : b.name,
      playerId: b.playerId,
      panelId: b.panelId,
      avatarSeed: b.avatarSeed,
      bet: b.bet,
      cashedOut: b.cashedOut,
      cashMult: b.cashMult,
      winAmount: b.winAmount,
      isMe: b.playerId === String(requestingPlayerId),
      isBot: false
    }));

    const botRows = this.botBets.map((b) => ({
      betKey: b.betKey,
      name: b.name,
      avatarSeed: b.avatarSeed,
      bet: b.bet,
      cashedOut: b.cashedOut,
      cashMult: b.cashMult,
      winAmount: b.winAmount,
      isMe: false,
      isBot: true
    }));

    const combined = [...realRows, ...botRows];
    let totalWin = 0;
    let cashedCount = 0;
    for (const row of combined) {
      if (row.cashedOut) {
        totalWin = roundMoney(totalWin + row.winAmount);
        cashedCount += 1;
      }
    }

    const totalDisplayBets = this.basePlayersCount + realRows.length;
    const botCashedRatio = this.botBets.length > 0
      ? this.botBets.filter((b) => b.cashedOut).length / this.botBets.length
      : 0;
    const realCashed = realRows.filter((b) => b.cashedOut).length;
    const activeBetsLeft = Math.max(
      0,
      totalDisplayBets - Math.round(botCashedRatio * this.basePlayersCount) - realCashed
    );

    return {
      rows: combined,
      totalDisplayBets,
      activeBetsLeft,
      totalWin,
      cashedCount
    };
  }

  getPlayerActiveBets(playerId) {
    const uid = String(playerId || '');
    const out = {};
    for (const b of this.bets.values()) {
      if (b.playerId === uid) {
        out[b.panelId] = {
          betKey: b.betKey,
          panelId: b.panelId,
          amount: b.bet,
          status: b.status,
          cashMult: b.cashMult,
          winAmount: b.winAmount,
          autoCashOut: b.autoCashOut
        };
      }
    }
    return out;
  }
}

module.exports = {
  PHASES,
  AviatorRound
};
