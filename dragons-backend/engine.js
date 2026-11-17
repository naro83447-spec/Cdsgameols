const { DragonsBalanceManager, MIN_BET, MAX_BET, roundMoney } = require('./balance');
const { BET_PRESETS, evaluatePayline, getPaytableForBet } = require('./paytable');
const { generateSpinOutcome } = require('./rng');

class DragonsEngine {
  constructor() {
    this.balanceManager = new DragonsBalanceManager();
    this.spinSeq = 1000;
    this.globalWins = [];
    this.biggestWin = {
      user: 'dragon_king',
      bet: 100.00,
      win: 10000.00,
      winType: 'RED_3'
    };
  }

  getPlayerState(playerId, displayName = '') {
    const acc = this.balanceManager.ensureAccount(playerId, displayName);
    return {
      playerId: acc.playerId,
      displayName: acc.displayName,
      credit: acc.credit,
      totalWagered: acc.totalWagered,
      totalWon: acc.totalWon,
      spinsCount: acc.spinsCount,
      minBet: MIN_BET,
      maxBet: MAX_BET,
      betPresets: BET_PRESETS,
      paytable: getPaytableForBet(5.00),
      history: this.balanceManager.getHistory(acc.playerId, 25),
      biggestWin: this.biggestWin,
      recentGlobalWins: this.globalWins.slice(0, 10)
    };
  }

  spin({ playerId, bet, clientSeed = '', displayName = '' }) {
    const acc = this.balanceManager.ensureAccount(playerId, displayName);
    const stake = roundMoney(bet);

    if (!Number.isFinite(stake) || stake < MIN_BET || stake > MAX_BET) {
      return {
        ok: false,
        code: 'INVALID_BET',
        error: `Bet must be between ETB ${MIN_BET.toFixed(2)} and ETB ${MAX_BET.toFixed(2)}`,
        credit: acc.credit
      };
    }

    if (acc.credit < stake) {
      return {
        ok: false,
        code: 'INSUFFICIENT_FUNDS',
        error: 'Insufficient funds to place this bet. Please fund your account (click credit to add) or lower the bet level.',
        credit: acc.credit
      };
    }

    this.spinSeq += 1;
    const spinId = `888d_${Date.now()}_${this.spinSeq}`;
    const outcome = generateSpinOutcome({ spinId, clientSeed });
    const evalRes = evaluatePayline(outcome.middleRow, stake);

    const settlement = this.balanceManager.settleSpin({
      playerId: acc.playerId,
      spinId,
      bet: stake,
      winAmount: evalRes.winAmount,
      middleRow: outcome.middleRow,
      winType: evalRes.winType,
      multiplier: evalRes.multiplier
    });

    if (!settlement.ok) {
      return settlement;
    }

    if (evalRes.winAmount > 0) {
      const winEntry = {
        user: acc.displayName,
        bet: stake,
        win: evalRes.winAmount,
        multiplier: evalRes.multiplier,
        label: evalRes.label,
        spinId
      };
      this.globalWins.unshift(winEntry);
      if (this.globalWins.length > 25) this.globalWins.length = 25;
      if (evalRes.winAmount > this.biggestWin.win) {
        this.biggestWin = winEntry;
      }
    }

    return {
      ok: true,
      spinId,
      bet: stake,
      reels: outcome.reels,
      middleRow: outcome.middleRow,
      winAmount: evalRes.winAmount,
      multiplier: evalRes.multiplier,
      winType: evalRes.winType,
      winLabel: evalRes.label,
      credit: settlement.credit,
      paytable: getPaytableForBet(stake),
      history: this.balanceManager.getHistory(acc.playerId, 25),
      fairnessProof: outcome.fairnessProof
    };
  }
}

module.exports = {
  DragonsEngine
};
