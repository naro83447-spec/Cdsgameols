const { AviatorBalanceManager, roundMoney } = require('./balance');
const { AviatorEngine, PHASES } = require('./engine');
const { generateRoundFairness } = require('./fairness');

const INITIAL_HISTORY = [
  4.48, 1.77, 2.26, 5.09, 9.32, 1.52, 9.14,
  1.08, 1.49, 4.91, 8.72, 4.37, 3.75, 1.55,
  1.00, 5.62, 1.06, 16.31, 2.36, 1.37, 7.98,
  6.03, 3.48, 1.31, 1.10, 30.77, 4.18, 1.10,
  2.78, 1.54, 1.18, 2.49, 1.03, 1.92, 2.97
];

const INITIAL_TOP_WINNERS = [
  { user: 'k***a', date: '16.11.26', bet: 2.00, mult: 855.10, win: 1710.20, roundMax: 1033.61, roundId: 1022302 },
  { user: 'x***t', date: '16.11.26', bet: 2.00, mult: 534.30, win: 1068.60, roundMax: 1033.61, roundId: 1022302 },
  { user: 'd***m', date: '16.11.26', bet: 4.00, mult: 391.73, win: 1566.93, roundMax: 513.86, roundId: 1022189 },
  { user: 'n***a', date: '16.11.26', bet: 4.00, mult: 302.22, win: 1208.88, roundMax: 317.78, roundId: 1022114 },
  { user: 'f***m', date: '16.11.26', bet: 20.00, mult: 323.34, win: 6466.83, roundMax: 333.49, roundId: 1022045 }
];

class AviatorGameRoom {
  constructor(options = {}) {
    this.roomId = options.roomId || 'aviator-main';
    this.balanceManager = new AviatorBalanceManager();
    this.engine = new AviatorEngine(options);

    this.io = null;
    this.socketPlayers = new Map(); // socketId -> playerId
    this.queuedBets = new Map();    // `${playerId}:${panelId}` -> queuedBetObj
    this._txSeq = 0;

    this.history = [...INITIAL_HISTORY];
    this.previousRoundResult = 1.77;
    this.previousRoundRows = [];
    this.topWinners = [...INITIAL_TOP_WINNERS];
    this.fairnessArchive = new Map();

    // Seed proof for round 1022302 & historical top rounds
    this.fairnessArchive.set(1022302, {
      ...generateRoundFairness({ roundId: 1022302 }),
      crashPoint: 1033.61
    });

    this.chatMessages = [
      { id: 'seed1', user: 'o***k', text: 'በአራዳን ነው ሚለው ወንድም', time: '19:16', isAdmin: false },
      { id: 'seed2', user: 'w***g', text: '@c***b አንተ ሙድ ለምን ትይዛለህ በናትህ', time: '19:17', isAdmin: false },
      { id: 'seed3', user: 'e***a', text: 'Admin', time: '19:18', isAdmin: false }
    ];
    this.activeRain = {
      rainId: 'rain_1',
      amount: 20.00,
      totalPool: 500.00,
      claimedCount: 3,
      maxClaims: 25
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

      // Convert all queued next-round bets into active bets for this new round
      for (const [qKey, q] of Array.from(this.queuedBets.entries())) {
        this.queuedBets.delete(qKey);
        const acc = this.balanceManager.ensureAccount(q.playerId);
        const added = round.addRealBet({
          playerId: q.playerId,
          panelId: q.panelId,
          maskedName: acc.maskedName,
          avatarSeed: acc.avatarSeed,
          amount: q.amount,
          autoCashOut: q.autoCashOut,
          clientSeed: q.clientSeed,
          ledgerKey: q.tempKey
        });

        if (!added.ok) {
          this.balanceManager.refundBet({
            playerId: q.playerId,
            amount: q.amount,
            roundId: round.roundId,
            betKey: q.tempKey
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
        const feed = round.getFeedRows();
        this.io.to(this.roomId).emit('round:waiting', {
          ...data,
          feed
        });
      }
    });

    this.engine.on('round:wait_tick', (data) => {
      if (this.io) {
        this.io.to(this.roomId).emit('round:wait_tick', data);
      }
    });

    this.engine.on('round:takeoff', (data) => {
      if (this.io) {
        this.io.to(this.roomId).emit('round:takeoff', data);
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
        payload.feed = this.engine.currentRound.getFeedRows();
      }
      this.io.to(this.roomId).emit('round:tick', payload);
    });

    this.engine.on('round:crashed', (data) => {
      const round = data.round;
      this.fairnessArchive.set(data.roundId, data.fairnessProof);

      // Record lost real bets into player history
      const affectedPlayers = new Set();
      for (const b of round.bets.values()) {
        if (b.status === 'LOST') {
          this.balanceManager.recordLoss({
            playerId: b.playerId,
            amount: b.bet,
            crashMultiplier: data.crashPoint,
            roundId: data.roundId,
            betKey: b.ledgerKey || b.betKey
          });
          affectedPlayers.add(b.playerId);
        }
      }

      // Update global history & previous round snapshot
      this.history.unshift(data.crashPoint);
      if (this.history.length > 42) this.history.length = 42;

      const feed = round.getFeedRows();
      this.previousRoundResult = data.crashPoint;
      this.previousRoundRows = feed.rows;

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
          previousRoundResult: this.previousRoundResult,
          previousRoundRows: this.previousRoundRows,
          topWinners: this.topWinners
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
      return { ok: false, error: 'Plane already flew away!' };
    }

    const credit = this.balanceManager.creditCashOut({
      playerId: bet.playerId,
      amount: bet.bet,
      multiplier: mult,
      roundId: round.roundId,
      betKey: bet.ledgerKey || bet.betKey
    });

    bet.status = 'CASHED_OUT';
    bet.cashedOut = true;
    bet.cashMult = mult;
    bet.winAmount = credit.winAmount;

    // Update Top Leaderboard if big win
    if (credit.winAmount >= 20 || mult >= 5) {
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yy = String(now.getFullYear()).slice(-2);
      this.topWinners.unshift({
        user: bet.name,
        date: `${dd}.${mm}.${yy}`,
        bet: bet.bet,
        mult,
        win: credit.winAmount,
        roundMax: round.crashPoint || mult,
        roundId: round.roundId
      });
      this.topWinners.sort((a, b) => b.mult - a.mult);
      if (this.topWinners.length > 25) this.topWinners.length = 25;
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
      this.io.to(this.roomId).emit('feed:update', {
        roundId: round.roundId,
        feed: round.getFeedRows()
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

  placeBet({ playerId, panelId = 1, amount, autoCashOut = null, clientSeed = '', displayName = '', avatarSeed = '' }) {
    const acc = this.balanceManager.ensureAccount(playerId, { displayName, avatarSeed });
    const pId = Number(panelId) === 2 ? 2 : 1;
    const round = this.engine.currentRound;

    if (!round) return { ok: false, error: 'Game engine initializing' };

    const qKey = `${acc.playerId}:${pId}`;
    const existingActive = round.bets.get(`${round.roundId}:${acc.playerId}:${pId}`);
    if ((existingActive && existingActive.status === 'PLACED') || this.queuedBets.has(qKey)) {
      return { ok: false, error: 'Bet already active on this panel' };
    }

    this._txSeq += 1;
    const opKey = `tx_${round.roundId}_${acc.playerId}_${pId}_${this._txSeq}`;

    const debit = this.balanceManager.debitBet({
      playerId: acc.playerId,
      amount,
      roundId: round.roundId,
      betKey: opKey
    });

    if (!debit.ok) {
      return { ok: false, error: debit.error, balance: debit.balance };
    }

    // Immediate placement if WAITING
    if (round.phase === PHASES.WAITING) {
      const added = round.addRealBet({
        playerId: acc.playerId,
        panelId: pId,
        maskedName: acc.maskedName,
        avatarSeed: acc.avatarSeed,
        amount: debit.bet,
        autoCashOut,
        clientSeed,
        ledgerKey: opKey
      });

      if (!added.ok) {
        this.balanceManager.refundBet({
          playerId: acc.playerId,
          amount: debit.bet,
          roundId: round.roundId,
          betKey: opKey
        });
        return { ok: false, error: added.error, balance: this.balanceManager.getBalance(acc.playerId) };
      }

      const feed = round.getFeedRows(acc.playerId);
      if (this.io) {
        this.io.to(this.roomId).emit('feed:update', { roundId: round.roundId, feed });
      }

      return {
        ok: true,
        queued: false,
        balance: debit.balance,
        activeBets: round.getPlayerActiveBets(acc.playerId),
        queuedBets: this._getQueuedForPlayer(acc.playerId),
        feed
      };
    }

    // Queue for next round if FLYING or CRASHED
    this.queuedBets.set(qKey, {
      tempKey: opKey,
      playerId: acc.playerId,
      panelId: pId,
      amount: debit.bet,
      autoCashOut: autoCashOut && Number(autoCashOut) >= 1.01 ? roundMoney(autoCashOut) : null,
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

    // 1. Cancel queued next-round bet
    if (this.queuedBets.has(qKey)) {
      const q = this.queuedBets.get(qKey);
      this.queuedBets.delete(qKey);
      const refund = this.balanceManager.refundBet({
        playerId: acc.playerId,
        amount: q.amount,
        roundId: this.engine.currentRound ? this.engine.currentRound.roundId : 0,
        betKey: q.tempKey
      });
      return {
        ok: true,
        balance: refund.balance,
        activeBets: this.engine.currentRound ? this.engine.currentRound.getPlayerActiveBets(acc.playerId) : {},
        queuedBets: this._getQueuedForPlayer(acc.playerId)
      };
    }

    // 2. Cancel current WAITING bet
    const round = this.engine.currentRound;
    if (!round || round.phase !== PHASES.WAITING) {
      return { ok: false, error: 'Cannot cancel bet after takeoff' };
    }

    const removed = round.removeRealBet(acc.playerId, pId);
    if (!removed.ok) {
      return { ok: false, error: removed.error, balance: acc.balance };
    }

    const refund = this.balanceManager.refundBet({
      playerId: acc.playerId,
      amount: removed.bet.bet,
      roundId: round.roundId,
      betKey: removed.bet.ledgerKey || removed.bet.betKey
    });

    const feed = round.getFeedRows(acc.playerId);
    if (this.io) {
      this.io.to(this.roomId).emit('feed:update', { roundId: round.roundId, feed });
    }

    return {
      ok: true,
      balance: refund.balance,
      activeBets: round.getPlayerActiveBets(acc.playerId),
      queuedBets: this._getQueuedForPlayer(acc.playerId),
      feed
    };
  }

  cashOut({ playerId, panelId = 1 }) {
    const uid = String(playerId || '');
    const pId = Number(panelId) === 2 ? 2 : 1;
    const round = this.engine.currentRound;
    if (!round || round.phase !== PHASES.FLYING) {
      return { ok: false, error: 'Round is not in flight' };
    }

    const bet = round.bets.get(`${round.roundId}:${uid}:${pId}`);
    if (!bet || bet.status !== 'PLACED') {
      return { ok: false, error: 'No active bet to cash out' };
    }

    return this._executeCashOut(bet, round.multiplier);
  }

  attachSocketIO(io) {
    this.io = io;

    io.on('connection', (socket) => {
      socket.join(this.roomId);

      const authPlayerId = socket.handshake.auth?.playerId || socket.handshake.query?.playerId;
      const boundId = String(authPlayerId || `p_${socket.id.slice(0, 8)}`);

      this.balanceManager.ensureAccount(boundId, {
        displayName: socket.handshake.auth?.displayName || 'd***u',
        avatarSeed: socket.handshake.auth?.avatarSeed || 'MercedesGold'
      });
      this.socketPlayers.set(socket.id, boundId);

      socket.emit('room:state', this.getSnapshot(boundId));

      socket.on('player:identify', (payload = {}, ack) => {
        const nextId = String(payload.playerId || boundId).trim() || boundId;
        this.balanceManager.ensureAccount(nextId, {
          displayName: payload.displayName || 'd***u',
          avatarSeed: payload.avatarSeed || ''
        });
        this.socketPlayers.set(socket.id, nextId);
        const snap = this.getSnapshot(nextId);
        socket.emit('room:state', snap);
        if (typeof ack === 'function') ack({ ok: true, state: snap });
      });

      socket.on('room:sync', (_, ack) => {
        const pid = this.socketPlayers.get(socket.id) || boundId;
        const snap = this.getSnapshot(pid);
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
          autoCashOut: payload.autoCashOut,
          clientSeed: payload.clientSeed,
          displayName: payload.displayName,
          avatarSeed: payload.avatarSeed
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

      socket.on('panel:autocash', (payload = {}) => {
        const pid = String(payload.playerId || this.socketPlayers.get(socket.id) || boundId);
        if (this.engine.currentRound) {
          this.engine.currentRound.updateAutoCashOut(pid, payload.panelId, payload.autoCashOut);
        }
        const qKey = `${pid}:${Number(payload.panelId) === 2 ? 2 : 1}`;
        if (this.queuedBets.has(qKey)) {
          this.queuedBets.get(qKey).autoCashOut = payload.autoCashOut || null;
        }
      });

      socket.on('balance:topup', (payload = {}, ack) => {
        const pid = String(payload.playerId || this.socketPlayers.get(socket.id) || boundId);
        const res = this.balanceManager.topUp(pid, payload.amount || 100);
        this._emitToPlayer(pid, 'player:sync', { balance: res.balance });
        if (typeof ack === 'function') ack(res);
      });

      socket.on('avatar:update', (payload = {}, ack) => {
        const pid = String(payload.playerId || this.socketPlayers.get(socket.id) || boundId);
        const acc = this.balanceManager.updateAvatar(pid, payload.avatarSeed);
        if (typeof ack === 'function') ack({ ok: true, avatarSeed: acc.avatarSeed });
      });

      socket.on('chat:send', (payload = {}, ack) => {
        const pid = String(payload.playerId || this.socketPlayers.get(socket.id) || boundId);
        const acc = this.balanceManager.ensureAccount(pid);
        const text = String(payload.text || '').trim().slice(0, 160);
        if (!text) return typeof ack === 'function' && ack({ ok: false });

        const now = new Date();
        const msg = {
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          user: acc.maskedName,
          playerId: pid,
          text,
          time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
          isAdmin: false
        };
        this.chatMessages.push(msg);
        if (this.chatMessages.length > 60) this.chatMessages.shift();

        this.io.to(this.roomId).emit('chat:message', msg);
        if (typeof ack === 'function') ack({ ok: true, message: msg });
      });

      socket.on('chat:claim_rain', (payload = {}, ack) => {
        const pid = String(payload.playerId || this.socketPlayers.get(socket.id) || boundId);
        const res = this.balanceManager.claimRain(
          pid,
          this.activeRain.rainId,
          this.activeRain.amount,
          this.activeRain.maxClaims
        );
        if (res.ok) {
          this.activeRain.claimedCount = res.claimedCount;
          this.io.to(this.roomId).emit('rain:update', { ...this.activeRain });
        }
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
      ...generateRoundFairness({ roundId: id || 1022302 }),
      crashPoint: this.previousRoundResult
    };
  }

  getSnapshot(playerId) {
    const round = this.engine.currentRound;
    const acc = this.balanceManager.ensureAccount(playerId);
    const feed = round ? round.getFeedRows(acc.playerId) : { rows: [], totalDisplayBets: 435, activeBetsLeft: 435, totalWin: 0 };

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
      onlinePlayers: 1080 + this.socketPlayers.size,
      history: this.history,
      previousRoundResult: this.previousRoundResult,
      previousRoundRows: this.previousRoundRows,
      topWinners: this.topWinners,
      feed,
      chatMessages: this.chatMessages,
      activeRain: this.activeRain,
      player: {
        playerId: acc.playerId,
        maskedName: acc.maskedName,
        avatarSeed: acc.avatarSeed,
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
  AviatorGameRoom
};
