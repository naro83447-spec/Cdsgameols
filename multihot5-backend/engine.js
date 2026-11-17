const { MultiHot5BalanceManager, MIN_BET, MAX_BET } = require('./balance');
const { BET_PRESETS, roundMoney, evaluateSpin, getPaytableForBet } = require('./paytable');
const { generateSpinOutcome, drawGambleCard } = require('./rng');

class MultiHot5Engine {
  constructor() {
    this.balanceManager = new MultiHot5BalanceManager();
    this.spinSeq = 1000;
    this.globalWins = [];
    this.biggestWin = {
      user: 'hot_seven_et',
      bet: 100.00,
      win: 25000.00,
      companionMultiplier: 5
    };
  }

  getPlayerState(playerId, displayName = '') {
    const acc = this.balanceManager.ensureAccount(playerId, displayName);
    return {
      playerId: acc.playerId,
      displayName: acc.displayName,
      balance: acc.balance,
      pendingGamble: acc.pendingGamble,
      totalWagered: acc.totalWagered,
      totalWon: acc.totalWon,
      spinsCount: acc.spinsCount,
      minBet: MIN_BET,
      maxBet: MAX_BET,
      betPresets: BET_PRESETS,
      paytable: getPaytableForBet(5.00),
      history: this.balanceManager.getHistory(acc.playerId, 30),
      biggestWin: this.biggestWin,
      recentGlobalWins: this.globalWins.slice(0, 12)
    };
  }

  spin({ playerId, bet, clientSeed = '', displayName = '' }) {
    const acc = this.balanceManager.ensureAccount(playerId, displayName);

    // Auto-collect any pending win from previous spin before placing new bet
    let autoCollected = 0;
    if (acc.pendingGamble) {
      const col = this.balanceManager.collectPendingWin(acc.playerId);
      autoCollected = col.collected || 0;
    }

    const stake = roundMoney(bet);
    if (!Number.isFinite(stake) || stake < MIN_BET || stake > MAX_BET) {
      return {
        ok: false,
        code: 'INVALID_BET',
        error: `Bet must be between ${MIN_BET.toFixed(2)} and ${MAX_BET.toFixed(2)} ETB`,
        balance: acc.balance
      };
    }

    if (acc.balance < stake) {
      return {
        ok: false,
        code: 'INSUFFICIENT_FUNDS',
        error: 'Insufficient balance! Click +500 on your balance or lower the bet.',
        balance: acc.balance
      };
    }

    this.spinSeq += 1;
    const spinId = `mh5_${Date.now()}_${this.spinSeq}`;
    const outcome = generateSpinOutcome({ spinId, clientSeed });
    const evalRes = evaluateSpin(outcome.reels, outcome.companionMultiplier, stake);

    const settlement = this.balanceManager.recordSpin({
      playerId: acc.playerId,
      spinId,
      bet: stake,
      winAmount: evalRes.totalWin,
      companionMultiplier: outcome.companionMultiplier,
      reels: outcome.reels,
      winningLines: evalRes.winningLines
    });

    if (!settlement.ok) return settlement;

    if (evalRes.totalWin > 0) {
      const winEntry = {
        user: acc.displayName,
        bet: stake,
        win: evalRes.totalWin,
        companionMultiplier: outcome.companionMultiplier,
        spinId
      };
      this.globalWins.unshift(winEntry);
      if (this.globalWins.length > 25) this.globalWins.length = 25;
      if (evalRes.totalWin > this.biggestWin.win) {
        this.biggestWin = winEntry;
      }
    }

    return {
      ok: true,
      spinId,
      bet: stake,
      autoCollected,
      reels: outcome.reels,
      companionMultiplier: outcome.companionMultiplier,
      winAmount: evalRes.totalWin,
      baseWin: evalRes.baseWin,
      totalMultiplier: evalRes.totalMultiplier,
      isFullScreen: evalRes.isFullScreen,
      winningLines: evalRes.winningLines,
      balance: settlement.balance,
      pendingGamble: settlement.pendingGamble,
      paytable: getPaytableForBet(stake),
      history: this.balanceManager.getHistory(acc.playerId, 30),
      fairnessProof: outcome.fairnessProof
    };
  }

  gamble({ playerId, choice }) {
    const acc = this.balanceManager.ensureAccount(playerId);
    const pending = acc.pendingGamble;

    if (!pending || pending.currentWin <= 0) {
      return { ok: false, error: 'No active win available to gamble.', balance: acc.balance };
    }

    if (pending.stepsUsed >= pending.stepsMax) {
      const collected = this.balanceManager.collectPendingWin(acc.playerId);
      return {
        ok: false,
        error: 'Maximum gamble limit reached! Win collected automatically.',
        balance: collected.balance,
        pendingGamble: null
      };
    }

    const card = drawGambleCard(choice);
    pending.stepsUsed += 1;
    pending.recentCards.unshift({
      rank: card.rank,
      glyph: card.glyph,
      color: card.cardColor
    });
    if (pending.recentCards.length > 8) pending.recentCards.length = 8;

    if (card.won) {
      pending.currentWin = roundMoney(pending.currentWin * 2);
      const entry = acc.history.find((h) => h.spinId === pending.spinId);
      if (entry) {
        entry.win = pending.currentWin;
      }

      // Auto-collect if final gamble step reached
      let autoCollected = false;
      if (pending.stepsUsed >= pending.stepsMax) {
        this.balanceManager.collectPendingWin(acc.playerId);
        autoCollected = true;
      }

      return {
        ok: true,
        won: true,
        card,
        currentWin: autoCollected ? 0 : pending.currentWin,
        finalWin: pending.currentWin,
        autoCollected,
        balance: acc.balance,
        pendingGamble: acc.pendingGamble,
        history: this.balanceManager.getHistory(acc.playerId, 30)
      };
    }

    // Wrong guess -> lose pending win
    const entry = acc.history.find((h) => h.spinId === pending.spinId);
    if (entry) {
      entry.win = 0;
      entry.status = 'GAMBLE_LOST';
    }
    acc.pendingGamble = null;
    acc.updatedAt = Date.now();

    return {
      ok: true,
      won: false,
      card,
      currentWin: 0,
      finalWin: 0,
      autoCollected: false,
      balance: acc.balance,
      pendingGamble: null,
      history: this.balanceManager.getHistory(acc.playerId, 30)
    };
  }

  collect({ playerId }) {
    const acc = this.balanceManager.ensureAccount(playerId);
    const res = this.balanceManager.collectPendingWin(acc.playerId);
    return {
      ok: true,
      collected: res.collected,
      balance: res.balance,
      pendingGamble: null,
      history: this.balanceManager.getHistory(acc.playerId, 30)
    };
  }
}

module.exports = {
  MultiHot5Engine
};
