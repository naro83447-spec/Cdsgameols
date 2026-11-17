const EventEmitter = require('events');
const { generateRoundFairness } = require('./fairness');
const { roundMoney } = require('./balance');
const { PHASES, AviatorRound } = require('./round');

class AviatorEngine extends EventEmitter {
  constructor(options = {}) {
    super();

    this.waitDurationMs = Math.max(2000, Number(options.waitDurationMs || process.env.AVIATOR_WAIT_MS || 5000));
    this.crashPauseMs = Math.max(1500, Number(options.crashPauseMs || process.env.AVIATOR_CRASH_PAUSE_MS || 3000));
    this.growthRate = Number(options.growthRate || 0.068);
    this.roundSeq = Number(options.initialRoundId || process.env.AVIATOR_INITIAL_ROUND_ID || 1022303);

    this.currentRound = null;
    this._timer = null;
    this._running = false;
  }

  _startNewRound() {
    const round = new AviatorRound(this.roundSeq, {
      waitDurationMs: this.waitDurationMs,
      crashPauseMs: this.crashPauseMs
    });
    this.currentRound = round;
    this.emit('round:waiting', {
      roundId: round.roundId,
      phase: round.phase,
      waitTimeTotal: round.waitDurationMs,
      waitTimeLeft: round.waitDurationMs,
      serverSeedHash: round.serverSeedHash
    });
    return round;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._startNewRound();
    this._timer = setInterval(() => this._tick(), 50);
  }

  stop() {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _tick() {
    if (!this._running || !this.currentRound) return;
    const now = Date.now();
    const round = this.currentRound;

    if (round.phase === PHASES.WAITING) {
      const waitLeft = round.getWaitTimeLeftMs(now);
      if (waitLeft > 0) {
        this.emit('round:wait_tick', {
          roundId: round.roundId,
          waitTimeLeft: waitLeft,
          waitTimeTotal: round.waitDurationMs
        });
        return;
      }

      // Transition WAITING -> FLYING
      const fairness = generateRoundFairness({
        roundId: round.roundId,
        serverSeed: round.serverSeed,
        clientSeeds: round.getTop3ClientSeeds()
      });

      round.fairnessProof = fairness;
      round.crashPoint = fairness.crashPoint;
      round.phase = PHASES.FLYING;
      round.flightStartedAt = now;
      round.multiplier = 1.00;

      this.emit('round:takeoff', {
        roundId: round.roundId,
        phase: round.phase,
        multiplier: 1.00,
        flightStartedAt: now,
        serverSeedHash: round.serverSeedHash
      });

      // Handle instant 1.00x crash cleanly
      if (round.crashPoint <= 1.00) {
        this._crashRound(now);
      }
      return;
    }

    if (round.phase === PHASES.FLYING) {
      const elapsedSec = (now - round.flightStartedAt) / 1000;
      const computed = Math.max(1.00, Math.floor(Math.exp(this.growthRate * elapsedSec) * 100) / 100);

      // 1. Trigger Auto Cash Outs whose target was crossed BEFORE crashPoint
      for (const bet of round.bets.values()) {
        if (
          bet.status === 'PLACED' &&
          bet.autoCashOut &&
          round.crashPoint > 1.00 &&
          computed >= bet.autoCashOut &&
          bet.autoCashOut < round.crashPoint
        ) {
          this.emit('bet:auto_cashout', {
            roundId: round.roundId,
            bet,
            multiplier: bet.autoCashOut
          });
        }
      }

      // 2. Trigger simulated bots cashing out
      let botsChanged = false;
      for (const bot of round.botBets) {
        if (!bot.cashedOut && computed >= bot.targetCashout && bot.targetCashout < round.crashPoint) {
          bot.cashedOut = true;
          bot.cashMult = bot.targetCashout;
          bot.winAmount = roundMoney(bot.bet * bot.targetCashout);
          botsChanged = true;
        }
      }

      // 3. Check crash condition
      if (computed >= round.crashPoint) {
        this._crashRound(now);
        return;
      }

      round.multiplier = computed;
      this.emit('round:tick', {
        roundId: round.roundId,
        phase: round.phase,
        multiplier: round.multiplier,
        elapsedMs: now - round.flightStartedAt,
        botsChanged
      });
      return;
    }

    if (round.phase === PHASES.CRASHED) {
      if (now >= round.crashEndsAt) {
        this.roundSeq += 1;
        this._startNewRound();
      }
    }
  }

  _crashRound(now) {
    const round = this.currentRound;
    if (!round || round.phase === PHASES.CRASHED) return;

    round.phase = PHASES.CRASHED;
    round.multiplier = round.crashPoint;
    round.crashedAt = now;
    round.crashEndsAt = now + round.crashPauseMs;

    for (const bet of round.bets.values()) {
      if (bet.status === 'PLACED') {
        bet.status = 'LOST';
      }
    }

    this.emit('round:crashed', {
      roundId: round.roundId,
      phase: round.phase,
      crashPoint: round.crashPoint,
      fairnessProof: round.fairnessProof,
      round
    });
  }
}

module.exports = {
  AviatorEngine,
  PHASES
};
