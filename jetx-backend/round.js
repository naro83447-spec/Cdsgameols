const crypto = require('crypto');
const { generateRandomSeed, sha256 } = require('./fairness');
const { roundMoney } = require('./balance');

const PHASES = {
  WAITING: 'WAITING',
  FLYING: 'FLYING',
  CRASHED: 'CRASHED'
};

class JetXRound {
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

    this.bets = new Map(); // `${roundId}:${playerId}:${panelId}` -> betObj
    this.botBets = this._createSimulatedBets();
  }

  _createSimulatedBets() {
    const count = 18;
    const stakes = [10, 20, 40, 50, 100, 200, 500, 1000];
    const bots = [];
    for (let i = 0; i < count; i++) {
      const uid = `user_${1000 + ((this.roundId * 73 + i * 317) % 8999)}`;
      const bet = stakes[Math.floor(Math.random() * stakes.length)];
      const targetCollect = Math.random() < 0.72
        ? roundMoney(1.15 + Math.random() * 4.2)
        : 9999;

      bots.push({
        betKey: `bot_${this.roundId}_${i}`,
        user: uid,
        bet,
        targetCollect,
        cashedOut: false,
        cashMult: null,
        winAmount: 0,
        isBot: true
      });
    }
    bots.sort((a, b) => b.bet - a.bet);
    return bots;
  }

  getWaitTimeLeftMs(now = Date.now()) {
    return Math.max(0, this.waitEndsAt - now);
  }

  addRealBet({ playerId, panelId, displayName, amount, autoCollect = false, autoCollectVal = 2.0, clientSeed = '', ledgerKey = '' }) {
    if (this.phase !== PHASES.WAITING) {
      return { ok: false, error: 'Wait for next round to place bet' };
    }

    const betKey = `${this.roundId}:${playerId}:${panelId}`;
    if (this.bets.has(betKey)) {
      return { ok: false, error: 'Bet already placed on this panel' };
    }

    const target = autoCollect && Number(autoCollectVal) >= 1.01
      ? roundMoney(autoCollectVal)
      : null;

    const betObj = {
      betKey,
      ledgerKey: ledgerKey || betKey,
      roundId: this.roundId,
      playerId: String(playerId),
      panelId: Number(panelId),
      user: displayName || String(playerId),
      bet: roundMoney(amount),
      autoCollect: Boolean(autoCollect && target),
      autoCollectVal: target || roundMoney(autoCollectVal || 2.0),
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
      return { ok: false, error: 'Cannot cancel bet after launch' };
    }
    const betKey = `${this.roundId}:${playerId}:${panelId}`;
    const existing = this.bets.get(betKey);
    if (!existing) {
      return { ok: false, error: 'No active bet to cancel' };
    }
    this.bets.delete(betKey);
    return { ok: true, bet: existing };
  }

  updateAutoCollect(playerId, panelId, autoCollect, autoCollectVal) {
    const betKey = `${this.roundId}:${playerId}:${panelId}`;
    const existing = this.bets.get(betKey);
    if (!existing || existing.status !== 'PLACED') return false;
    const target = Number(autoCollectVal) >= 1.01 ? roundMoney(autoCollectVal) : 2.0;
    existing.autoCollect = Boolean(autoCollect);
    existing.autoCollectVal = target;
    return true;
  }

  getTop3ClientSeeds() {
    return Array.from(this.bets.values()).slice(0, 3).map((b) => ({
      player: b.user,
      seed: b.clientSeed
    }));
  }

  getLivePlayersRows(requestingPlayerId = '') {
    const realRows = Array.from(this.bets.values()).map((b) => ({
      betKey: b.betKey,
      user: b.playerId === String(requestingPlayerId) ? `${b.user} (You)` : b.user,
      playerId: b.playerId,
      panelId: b.panelId,
      bet: b.bet,
      cashedOut: b.cashedOut,
      cashMult: b.cashMult,
      winAmount: b.winAmount,
      isMe: b.playerId === String(requestingPlayerId),
      isBot: false
    }));

    const botRows = this.botBets.map((b) => ({
      betKey: b.betKey,
      user: b.user,
      bet: b.bet,
      cashedOut: b.cashedOut,
      cashMult: b.cashMult,
      winAmount: b.winAmount,
      isMe: false,
      isBot: true
    }));

    return [...realRows, ...botRows];
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
          cashedOut: b.cashedOut,
          cashMult: b.cashMult,
          winAmount: b.winAmount,
          autoCollect: b.autoCollect,
          autoCollectVal: b.autoCollectVal
        };
      }
    }
    return out;
  }
}

module.exports = {
  PHASES,
  JetXRound
};
