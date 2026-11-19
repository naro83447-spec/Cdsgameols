const { AviatorBalanceManager } = require('./balance');
const { AviatorEngine, PHASES } = require('./engine');
const aviatorWallet = require('./firestore-wallet');

class AviatorGameRoom {
  constructor(options = {}) {
    this.roomId = options.roomId || 'aviator-main';
    this.balanceManager = new AviatorBalanceManager();
    this.engine = new AviatorEngine(options);

    this.io = null;
    this.socketPlayers = new Map(); // socketId -> playerId
    this.queuedBets = new Map();    // `${playerId}:${panelId}` -> queuedBetObj
    this._txSeq = 0;

    this.history = [];
    this.previousRoundResult = null;
    this.previousRoundRows = [];
    this.topWinners = [];
    this.fairnessArchive = new Map();

    this.chatMessages = [];
    this.activeRain = null;

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

      // Do not expose in-memory rounds as historical records; persistence is not implemented yet.
      this.history = [];
      this.previousRoundResult = null;
      this.previousRoundRows = [];

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

  _executeCashOut() {
    return { ok: false, error: 'Aviator wagering is disabled until the secure Firestore wallet migration and security tests are complete.' };
  }

  placeBet() {
    return { ok: false, error: 'Aviator wagering is disabled until the secure Firestore wallet migration and security tests are complete.' };
  }

  cancelBet() {
    return { ok: false, error: 'Aviator wagering is disabled until the secure Firestore wallet migration and security tests are complete.' };
  }

  cashOut() {
    return { ok: false, error: 'Aviator wagering is disabled until the secure Firestore wallet migration and security tests are complete.' };
  }

  attachSocketIO(io) {
    this.io = io;

    io.on('connection', (socket) => {
      socket.join(this.roomId);

      const boundId = String(socket.data.uid || '');
      if (!boundId) return socket.disconnect(true);

      this.balanceManager.ensureAccount(boundId, {
        displayName: socket.handshake.auth?.displayName || 'd***u',
        avatarSeed: socket.handshake.auth?.avatarSeed || 'MercedesGold'
      });
      this.socketPlayers.set(socket.id, boundId);

      this._getAuthenticatedSnapshot(boundId).then((snap) => socket.emit('room:state', snap)).catch(() => socket.disconnect(true));

      socket.on('player:identify', (payload = {}, ack) => {
        const nextId = boundId;
        this.balanceManager.ensureAccount(nextId, {
          displayName: payload.displayName || 'd***u',
          avatarSeed: payload.avatarSeed || ''
        });
        this.socketPlayers.set(socket.id, nextId);
        this._getAuthenticatedSnapshot(nextId).then((snap) => {
          socket.emit('room:state', snap);
          if (typeof ack === 'function') ack({ ok: true, state: snap });
        }).catch(() => { if (typeof ack === 'function') ack({ ok: false, error: 'Wallet unavailable.' }); });
      });

      socket.on('room:sync', (_, ack) => {
        const pid = boundId;
        this._getAuthenticatedSnapshot(pid).then((snap) => {
          socket.emit('room:state', snap);
          if (typeof ack === 'function') ack({ ok: true, state: snap });
        }).catch(() => { if (typeof ack === 'function') ack({ ok: false, error: 'Wallet unavailable.' }); });
      });

      socket.on('bet:place', (payload = {}, ack) => {
        const pid = boundId;
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
    return null;
  }

  async _getAuthenticatedSnapshot(uid) {
    const snapshot = this.getSnapshot(uid);
    const wallet = await aviatorWallet.ensureWallet(uid);
    snapshot.player.balance = wallet.balance;
    snapshot.player.betHistory = await aviatorWallet.getBetHistory(uid, 40);
    return snapshot;
  }

  getSnapshot(playerId) {
    const round = this.engine.currentRound;
    const acc = this.balanceManager.ensureAccount(playerId);
    const feed = round ? round.getFeedRows(acc.playerId) : { rows: [], totalDisplayBets: 0, activeBetsLeft: 0, totalWin: 0, cashedCount: 0 };

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
      onlinePlayers: this.socketPlayers.size,
      history: this.history,
      previousRoundResult: this.previousRoundResult,
      previousRoundRows: this.previousRoundRows,
      topWinners: this.topWinners,
      feed,
      chatMessages: this.chatMessages,
      activeRain: null,
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
