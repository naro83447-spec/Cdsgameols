const crypto = require('crypto');
const { generateRandomSeed, sha256 } = require('./fairness');
const { roundMoney } = require('./balance');

const PHASES = {
  WAITING: 'WAITING',
  FLYING: 'FLYING',
  CRASHED: 'CRASHED'
};

class RocketRound {
  constructor(roundId, config = {}) {
    this.roundId = Number(roundId);
    this.phase = PHASES.WAITING;

    this.waitDurationMs = Number(config.waitDurationMs || 3500);
    this.crashPauseMs = Number(config.crashPauseMs || 2500);

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
    const count = 16;
    const stakes = [20, 40, 80, 100, 200, 500, 1000];
    const bots = [];
    for (let i = 0; i < count; i++) {
      const uid = `pilot_${1000 + ((this.roundId * 79 + i * 293) % 8999)}`;
      const bet = stakes[Math.floor(Math.random() * stakes.length)];
      const targetCollect = Math.random() < 0.74
        ? roundMoney(1.18 + Math.random() * 4.5)
        : 9999;

      bots.push({
        betKey: `rbot_${this.roundId}_${i}`,
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

  addRealBet({ playerId, panelId, displayName, amount, autoCashout = false, autoCashoutVal = 2.0, clientSeed = '', ledgerKey = '' }) {
    if (this.phase !== PHASES.WAITING) {
      return { ok: false, error: 'Wait for next round to place bet' };
    }

    const betKey = `${this.roundId}:${playerId}:${panelId}`;
    if (this.bets.has(betKey)) {
      return { ok: false, error: 'Bet already placed on this ticket' };
    }

    const target = autoCashout && Number(autoCashoutVal) >= 1.01
      ? roundMoney(autoCashoutVal)
      : null;

    const betObj = {
      betKey,
      ledgerKey: ledgerKey || betKey,
      roundId: this.roundId,
      playerId: String(playerId),
      panelId: Number(panelId),
      user: displayName || String(playerId),
      bet: roundMoney(amount),
      autoCashout: Boolean(autoCashout && target),
      autoCashoutVal: target || roundMoney(autoCashoutVal || 2.0),
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

  updateAutoCashout(playerId, panelId, autoCashout, autoCashoutVal) {
    const betKey = `${this.roundId}:${playerId}:${panelId}`;
    const existing = this.bets.get(betKey);
    if (!existing || existing.status !== 'PLACED') return false;
    const target = Number(autoCashoutVal) >= 1.01 ? roundMoney(autoCashoutVal) : 2.0;
    existing.autoCashout = Boolean(autoCashout);
    existing.autoCashoutVal = target;
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
          autoCashout: b.autoCashout,
          autoCashoutVal: b.autoCashoutVal
        };
      }
    }
    return out;
  }
}

module.exports = {
  PHASES,
  RocketRound
};
