const EventEmitter = require('events');
const { generateRocketFairness } = require('./fairness');
const { roundMoney } = require('./balance');
const { PHASES, RocketRound } = require('./round');

class RocketEngine extends EventEmitter {
  constructor(options = {}) {
    super();

    this.waitDurationMs = Math.max(2000, Number(options.waitDurationMs || process.env.ROCKET_WAIT_MS || 3500));
    this.crashPauseMs = Math.max(1500, Number(options.crashPauseMs || process.env.ROCKET_CRASH_PAUSE_MS || 2500));
    this.roundSeq = Number(options.initialRoundId || process.env.ROCKET_INITIAL_ROUND_ID || 710400);

    this.currentRound = null;
    this._timer = null;
    this._running = false;
  }

  _startNewRound() {
    const round = new RocketRound(this.roundSeq, {
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

      // WAITING -> FLYING
      const fairness = generateRocketFairness({
        roundId: round.roundId,
        serverSeed: round.serverSeed,
        clientSeeds: round.getTop3ClientSeeds()
      });

      round.fairnessProof = fairness;
      round.crashPoint = fairness.crashPoint;
      round.phase = PHASES.FLYING;
      round.flightStartedAt = now;
      round.multiplier = 1.00;

      this.emit('round:launch', {
        roundId: round.roundId,
        phase: round.phase,
        multiplier: 1.00,
        flightStartedAt: now,
        serverSeedHash: round.serverSeedHash
      });

      if (round.crashPoint <= 1.00) {
        this._crashRound(now);
      }
      return;
    }

    if (round.phase === PHASES.FLYING) {
      const elapsedSec = Math.max(0, (now - round.flightStartedAt) / 1000);
      const computed = Math.max(
        1.00,
        Math.floor((1.00 + Math.pow(elapsedSec, 1.55) * 0.14) * 100) / 100
      );

      // 1. Server-checked Auto Cashout before crash
      for (const bet of round.bets.values()) {
        if (
          bet.status === 'PLACED' &&
          bet.autoCashout &&
          bet.autoCashoutVal >= 1.01 &&
          round.crashPoint > 1.00 &&
          computed >= bet.autoCashoutVal &&
          bet.autoCashoutVal < round.crashPoint
        ) {
          this.emit('bet:auto_cashout', {
            roundId: round.roundId,
            bet,
            multiplier: bet.autoCashoutVal
          });
        }
      }

      // 2. Simulated crowd cashouts
      let botsChanged = false;
      for (const bot of round.botBets) {
        if (!bot.cashedOut && computed >= bot.targetCollect && bot.targetCollect < round.crashPoint) {
          bot.cashedOut = true;
          bot.cashMult = bot.targetCollect;
          bot.winAmount = roundMoney(bot.bet * bot.targetCollect);
          botsChanged = true;
        }
      }

      // 3. Crash check
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
  RocketEngine,
  PHASES
};
