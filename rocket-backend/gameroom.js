const { RocketBalanceManager, roundMoney } = require('./balance');
const { RocketEngine, PHASES } = require('./engine');
const { generateRocketFairness } = require('./fairness');

const INITIAL_HISTORY = [1.57, 2.06, 1.05, 3.50, 1.22, 4.12, 1.39];

class RocketGameRoom {
  constructor(options = {}) {
    this.roomId = options.roomId || 'rocket-main';
    this.balanceManager = new RocketBalanceManager();
    this.engine = new RocketEngine(options);

    this.io = null;
    this.socketPlayers = new Map(); // socketId -> playerId
    this.queuedBets = new Map();    // `${playerId}:${panelId}` -> queuedBetObj
    this._txSeq = 0;

    this.history = [...INITIAL_HISTORY];
    this.fairnessArchive = new Map();

    this.stats = {
      topMultiplierToday: 84.20,
      biggestWinToday: 38400.00,
      topWinners: [
        { user: 'shamo_king', bet: 800.00, mult: 48.00, win: 38400.00, roundId: 710392 },
        { user: 'astro_et', bet: 200.00, mult: 84.20, win: 16840.00, roundId: 710388 },
        { user: 'pilot_9042', bet: 500.00, mult: 14.60, win: 7300.00, roundId: 710379 }
      ]
    };

    this._bindEngineEvents();
  }

  _emitToPlayer(playerId, eventName, payload) {
    if (!this.io) return;
    const uid = String(playerId);
    for (const [socketId, boundUid] of this.socketPlayers.entries()) {
      if (boundUid === uid) {
        this.io.to(socketId).emit(eventName, payload);
      }
    }
  }

  _getQueuedForPlayer(playerId) {
    const uid = String(playerId || '');
    const queued = {};
    for (const q of this.queuedBets.values()) {
      if (q.playerId === uid) {
        queued[q.panelId] = q;
      }
    }
    return queued;
  }

  _bindEngineEvents() {
    this.engine.on('round:waiting', (data) => {
      const round = this.engine.currentRound;
      const promotedPlayers = new Set();

      for (const [qKey, q] of Array.from(this.queuedBets.entries())) {
        this.queuedBets.delete(qKey);
        const acc = this.balanceManager.ensureAccount(q.playerId);
        const added = round.addRealBet({
          playerId: q.playerId,
          panelId: q.panelId,
          displayName: acc.displayName,
          amount: q.amount,
          autoCashout: q.autoCashout,
          autoCashoutVal: q.autoCashoutVal,
          clientSeed: q.clientSeed,
          ledgerKey: q.tempKey
        });

        if (!added.ok) {
          this.balanceManager.refundBet({
            playerId: q.playerId,
            amount: q.amount,
            roundId: round.roundId,
            ledgerKey: q.tempKey
          });
        }
        promotedPlayers.add(q.playerId);
      }

      for (const pid of promotedPlayers) {
        this._emitToPlayer(pid, 'player:sync', {
          balance: this.balanceManager.getBalance(pid),
          activeBets: round.getPlayerActiveBets(pid),
          queuedBets: this._getQueuedForPlayer(pid)
        });
      }

      if (this.io) {
        this.io.to(this.roomId).emit('round:waiting', {
          ...data,
          players: round.getLivePlayersRows()
        });
      }
    });

    this.engine.on('round:wait_tick', (data) => {
      if (this.io) {
        this.io.to(this.roomId).emit('round:wait_tick', data);
      }
    });

    this.engine.on('round:launch', (data) => {
      if (this.io) {
        this.io.to(this.roomId).emit('round:launch', data);
      }
    });

    this.engine.on('bet:auto_cashout', ({ bet, multiplier }) => {
      this._executeCashOut(bet, multiplier);
    });

    this.engine.on('round:tick', (data) => {
      if (!this.io) return;
      const payload = {
        roundId: data.roundId,
        phase: data.phase,
        multiplier: data.multiplier,
        elapsedMs: data.elapsedMs
      };
      if (data.botsChanged && this.engine.currentRound) {
        payload.players = this.engine.currentRound.getLivePlayersRows();
      }
      this.io.to(this.roomId).emit('round:tick', payload);
    });

    this.engine.on('round:crashed', (data) => {
      const round = data.round;
      this.fairnessArchive.set(data.roundId, data.fairnessProof);

      if (data.crashPoint > this.stats.topMultiplierToday) {
        this.stats.topMultiplierToday = data.crashPoint;
      }

      const affectedPlayers = new Set();
      for (const b of round.bets.values()) {
        if (b.status === 'LOST') {
          this.balanceManager.recordLoss({
            playerId: b.playerId,
            amount: b.bet,
            crashMultiplier: data.crashPoint,
            roundId: data.roundId,
            ledgerKey: b.ledgerKey || b.betKey
          });
          affectedPlayers.add(b.playerId);
        }
      }

      this.history.unshift(data.crashPoint);
      if (this.history.length > 30) this.history.length = 30;

      for (const pid of affectedPlayers) {
        this._emitToPlayer(pid, 'player:sync', {
          balance: this.balanceManager.getBalance(pid),
          activeBets: round.getPlayerActiveBets(pid),
          queuedBets: this._getQueuedForPlayer(pid),
          betHistory: this.balanceManager.getBetHistory(pid, 40)
        });
      }

      if (this.io) {
        this.io.to(this.roomId).emit('round:crashed', {
          roundId: data.roundId,
          phase: data.phase,
          crashPoint: data.crashPoint,
          fairnessProof: data.fairnessProof,
          history: this.history,
          stats: this.stats,
          players: round.getLivePlayersRows()
        });
      }
    });
  }

  _executeCashOut(bet, exactMultiplier) {
    const round = this.engine.currentRound;
    if (!round || round.phase !== PHASES.FLYING || bet.status !== 'PLACED') {
      return { ok: false, error: 'Cannot cash out right now' };
    }

    const mult = roundMoney(exactMultiplier || round.multiplier);
    if (mult >= round.crashPoint) {
      return { ok: false, error: 'Rocket already flew away!' };
    }

    const credit = this.balanceManager.creditCashOut({
      playerId: bet.playerId,
      amount: bet.bet,
      multiplier: mult,
      roundId: round.roundId,
      ledgerKey: bet.ledgerKey || bet.betKey
    });

    bet.status = 'CASHED_OUT';
    bet.cashedOut = true;
    bet.cashMult = mult;
    bet.winAmount = credit.winAmount;

    if (credit.winAmount > this.stats.biggestWinToday) {
      this.stats.biggestWinToday = credit.winAmount;
    }
    if (mult > this.stats.topMultiplierToday) {
      this.stats.topMultiplierToday = mult;
    }
    if (credit.winAmount >= 50 || mult >= 5) {
      this.stats.topWinners.unshift({
        user: bet.user,
        bet: bet.bet,
        mult,
        win: credit.winAmount,
        roundId: round.roundId
      });
      this.stats.topWinners.sort((a, b) => b.win - a.win);
      if (this.stats.topWinners.length > 15) this.stats.topWinners.length = 15;
    }

    this._emitToPlayer(bet.playerId, 'bet:cashed_out', {
      panelId: bet.panelId,
      roundId: round.roundId,
      bet: bet.bet,
      mult,
      winAmount: credit.winAmount,
      balance: credit.balance,
      activeBets: round.getPlayerActiveBets(bet.playerId),
      betHistory: this.balanceManager.getBetHistory(bet.playerId, 40)
    });

    if (this.io) {
      this.io.to(this.roomId).emit('players:update', {
        roundId: round.roundId,
        players: round.getLivePlayersRows()
      });
    }

    return {
      ok: true,
      panelId: bet.panelId,
      mult,
      winAmount: credit.winAmount,
      balance: credit.balance
    };
  }

  placeBet({ playerId, panelId = 1, amount, autoCashout = false, autoCashoutVal = 2.0, clientSeed = '', displayName = '' }) {
    const acc = this.balanceManager.ensureAccount(playerId, { displayName });
    const pId = Number(panelId) === 2 ? 2 : 1;
    const round = this.engine.currentRound;

    if (!round) return { ok: false, error: 'Game engine initializing' };

    const qKey = `${acc.playerId}:${pId}`;
    const existingActive = round.bets.get(`${round.roundId}:${acc.playerId}:${pId}`);
    if ((existingActive && existingActive.status === 'PLACED') || this.queuedBets.has(qKey)) {
      return { ok: false, error: 'Bet already active on this ticket' };
    }

    this._txSeq += 1;
    const opKey = `rk_${round.roundId}_${acc.playerId}_${pId}_${this._txSeq}`;

    const debit = this.balanceManager.debitBet({
      playerId: acc.playerId,
      amount,
      roundId: round.roundId,
      ledgerKey: opKey
    });

    if (!debit.ok) {
      return { ok: false, error: debit.error, balance: debit.balance };
    }

    if (round.phase === PHASES.WAITING) {
      const added = round.addRealBet({
        playerId: acc.playerId,
        panelId: pId,
        displayName: acc.displayName,
        amount: debit.bet,
        autoCashout,
        autoCashoutVal,
        clientSeed,
        ledgerKey: opKey
      });

      if (!added.ok) {
        this.balanceManager.refundBet({
          playerId: acc.playerId,
          amount: debit.bet,
          roundId: round.roundId,
          ledgerKey: opKey
        });
        return { ok: false, error: added.error, balance: this.balanceManager.getBalance(acc.playerId) };
      }

      const players = round.getLivePlayersRows(acc.playerId);
      if (this.io) {
        this.io.to(this.roomId).emit('players:update', { roundId: round.roundId, players });
      }

      return {
        ok: true,
        queued: false,
        balance: debit.balance,
        activeBets: round.getPlayerActiveBets(acc.playerId),
        queuedBets: this._getQueuedForPlayer(acc.playerId),
        players
      };
    }

    // Queue for next round while FLYING or CRASHED
    this.queuedBets.set(qKey, {
      tempKey: opKey,
      playerId: acc.playerId,
      panelId: pId,
      amount: debit.bet,
      autoCashout: Boolean(autoCashout),
      autoCashoutVal: Number(autoCashoutVal) >= 1.01 ? roundMoney(autoCashoutVal) : 2.0,
      clientSeed
    });

    return {
      ok: true,
      queued: true,
      balance: debit.balance,
      activeBets: round.getPlayerActiveBets(acc.playerId),
      queuedBets: this._getQueuedForPlayer(acc.playerId)
    };
  }

  cancelBet({ playerId, panelId = 1 }) {
    const acc = this.balanceManager.ensureAccount(playerId);
    const pId = Number(panelId) === 2 ? 2 : 1;
    const qKey = `${acc.playerId}:${pId}`;

    if (this.queuedBets.has(qKey)) {
      const q = this.queuedBets.get(qKey);
      this.queuedBets.delete(qKey);
      const refund = this.balanceManager.refundBet({
        playerId: acc.playerId,
        amount: q.amount,
        roundId: this.engine.currentRound ? this.engine.currentRound.roundId : 0,
        ledgerKey: q.tempKey
      });
      return {
        ok: true,
        balance: refund.balance,
        activeBets: this.engine.currentRound ? this.engine.currentRound.getPlayerActiveBets(acc.playerId) : {},
        queuedBets: this._getQueuedForPlayer(acc.playerId)
      };
    }

    const round = this.engine.currentRound;
    if (!round || round.phase !== PHASES.WAITING) {
      return { ok: false, error: 'Cannot cancel bet after launch' };
    }

    const removed = round.removeRealBet(acc.playerId, pId);
    if (!removed.ok) {
      return { ok: false, error: removed.error, balance: acc.balance };
    }

    const refund = this.balanceManager.refundBet({
      playerId: acc.playerId,
      amount: removed.bet.bet,
      roundId: round.roundId,
      ledgerKey: removed.bet.ledgerKey || removed.bet.betKey
    });

    const players = round.getLivePlayersRows(acc.playerId);
    if (this.io) {
      this.io.to(this.roomId).emit('players:update', { roundId: round.roundId, players });
    }

    return {
      ok: true,
      balance: refund.balance,
      activeBets: round.getPlayerActiveBets(acc.playerId),
      queuedBets: this._getQueuedForPlayer(acc.playerId),
      players
    };
  }

  cashOut({ playerId, panelId = 1 }) {
    const uid = String(playerId || '');
    const pId = Number(panelId) === 2 ? 2 : 1;
    const round = this.engine.currentRound;
    if (!round || round.phase !== PHASES.FLYING) {
      return { ok: false, error: 'Rocket is not in flight right now' };
    }

    const bet = round.bets.get(`${round.roundId}:${uid}:${pId}`);
    if (!bet || bet.status !== 'PLACED') {
      return { ok: false, error: 'No active bet to cash out' };
    }

    return this._executeCashOut(bet, round.multiplier);
  }

  attachSocketIO(ioOrNamespace) {
    this.io = ioOrNamespace;

    this.io.on('connection', (socket) => {
      socket.join(this.roomId);

      const authPlayerId = socket.handshake.auth?.playerId || socket.handshake.query?.playerId;
      const boundId = String(authPlayerId || `pilot_${socket.id.slice(0, 6)}`);

      this.balanceManager.ensureAccount(boundId, {
        displayName: socket.handshake.auth?.displayName || boundId
      });
      this.socketPlayers.set(socket.id, boundId);

      socket.emit('room:state', this.getSnapshot(boundId));

      socket.on('player:identify', (payload = {}, ack) => {
        const nextId = String(payload.playerId || boundId).trim() || boundId;
        this.balanceManager.ensureAccount(nextId, {
          displayName: payload.displayName || nextId
        });
        this.socketPlayers.set(socket.id, nextId);
        const snap = this.getSnapshot(nextId);
        socket.emit('room:state', snap);
        if (typeof ack === 'function') ack({ ok: true, state: snap });
      });

      socket.on('bet:place', (payload = {}, ack) => {
        const pid = String(payload.playerId || this.socketPlayers.get(socket.id) || boundId);
        this.socketPlayers.set(socket.id, pid);
        const res = this.placeBet({
          playerId: pid,
          panelId: payload.panelId,
          amount: payload.amount,
          autoCashout: payload.autoCashout,
          autoCashoutVal: payload.autoCashoutVal,
          clientSeed: payload.clientSeed,
          displayName: payload.displayName
        });
        if (typeof ack === 'function') ack(res);
      });

      socket.on('bet:cancel', (payload = {}, ack) => {
        const pid = String(payload.playerId || this.socketPlayers.get(socket.id) || boundId);
        const res = this.cancelBet({ playerId: pid, panelId: payload.panelId });
        if (typeof ack === 'function') ack(res);
      });

      socket.on('bet:cashout', (payload = {}, ack) => {
        const pid = String(payload.playerId || this.socketPlayers.get(socket.id) || boundId);
        const res = this.cashOut({ playerId: pid, panelId: payload.panelId });
        if (typeof ack === 'function') ack(res);
      });

      socket.on('panel:autocashout', (payload = {}) => {
        const pid = String(payload.playerId || this.socketPlayers.get(socket.id) || boundId);
        if (this.engine.currentRound) {
          this.engine.currentRound.updateAutoCashout(pid, payload.panelId, payload.autoCashout, payload.autoCashoutVal);
        }
        const qKey = `${pid}:${Number(payload.panelId) === 2 ? 2 : 1}`;
        if (this.queuedBets.has(qKey)) {
          const q = this.queuedBets.get(qKey);
          q.autoCashout = Boolean(payload.autoCashout);
          q.autoCashoutVal = Number(payload.autoCashoutVal) >= 1.01 ? roundMoney(payload.autoCashoutVal) : 2.0;
        }
      });

      socket.on('balance:bonus', (payload = {}, ack) => {
        const pid = String(payload.playerId || this.socketPlayers.get(socket.id) || boundId);
        const res = this.balanceManager.addBonusBalance(pid, payload.amount || 500);
        this._emitToPlayer(pid, 'player:sync', { balance: res.balance });
        if (typeof ack === 'function') ack(res);
      });

      socket.on('disconnect', () => {
        this.socketPlayers.delete(socket.id);
      });
    });
  }

  getFairnessProof(roundId) {
    const id = Number(roundId);
    if (this.fairnessArchive.has(id)) {
      return this.fairnessArchive.get(id);
    }
    return {
      ...generateRocketFairness({ roundId: id || 710400 }),
      crashPoint: this.history[0] || 1.00
    };
  }

  getSnapshot(playerId) {
    const round = this.engine.currentRound;
    const acc = this.balanceManager.ensureAccount(playerId);

    return {
      roomId: this.roomId,
      serverTime: Date.now(),
      roundId: round ? round.roundId : this.engine.roundSeq,
      phase: round ? round.phase : PHASES.WAITING,
      multiplier: round ? round.multiplier : 1.00,
      waitTimeTotal: round ? round.waitDurationMs : this.engine.waitDurationMs,
      waitTimeLeft: round ? round.getWaitTimeLeftMs() : this.engine.waitDurationMs,
      flightElapsedMs: round && round.phase === PHASES.FLYING ? Date.now() - round.flightStartedAt : 0,
      serverSeedHash: round ? round.serverSeedHash : '',
      onlineCount: 48 + this.socketPlayers.size,
      history: this.history,
      players: round ? round.getLivePlayersRows(acc.playerId) : [],
      stats: this.stats,
      player: {
        playerId: acc.playerId,
        displayName: acc.displayName,
        balance: acc.balance,
        activeBets: round ? round.getPlayerActiveBets(acc.playerId) : {},
        queuedBets: this._getQueuedForPlayer(acc.playerId),
        betHistory: this.balanceManager.getBetHistory(acc.playerId, 40)
      }
    };
  }

  start() {
    this.engine.start();
  }

  stop() {
    this.engine.stop();
  }
}

module.exports = {
  RocketGameRoom
};
