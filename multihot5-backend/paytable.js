const BET_PRESETS = [1, 2, 5, 10, 20, 50, 100, 200];

/**
 * Classic Multi Hot 5 symbol hierarchy & payouts (as multiplier of total spin bet)
 * Weighted together with the 1X-5X Companion Multiplier Reel to deliver ~97.05% RTP.
 */
const SYMBOLS = {
  SEVEN:      { id: 'SEVEN',      name: 'Red 7',      weight: 3,  payoutMult: 50.0, color: '#ef4444' },
  BELL:       { id: 'BELL',       name: 'Gold Bell',  weight: 5,  payoutMult: 20.0, color: '#facc15' },
  WATERMELON: { id: 'WATERMELON', name: 'Watermelon', weight: 7,  payoutMult: 10.0, color: '#22c55e' },
  GRAPES:     { id: 'GRAPES',     name: 'Grapes',     weight: 8,  payoutMult: 8.0,  color: '#a855f7' },
  PLUM:       { id: 'PLUM',       name: 'Plum',       weight: 10, payoutMult: 5.0,  color: '#c084fc' },
  ORANGE:     { id: 'ORANGE',     name: 'Orange',     weight: 11, payoutMult: 4.0,  color: '#f97316' },
  LEMON:      { id: 'LEMON',      name: 'Lemon',      weight: 14, payoutMult: 3.0,  color: '#fde047' },
  CHERRY:     { id: 'CHERRY',     name: 'Cherries',   weight: 18, payoutMult: 1.6,  color: '#fb7185' }
};

const SYMBOL_LIST = Object.values(SYMBOLS);
const TOTAL_SYMBOL_WEIGHT = SYMBOL_LIST.reduce((sum, s) => sum + s.weight, 0);

const MULTIPLIER_REEL = [
  { mult: 1, weight: 39 },
  { mult: 2, weight: 28 },
  { mult: 3, weight: 17 },
  { mult: 4, weight: 9 },
  { mult: 5, weight: 7 }
];
const TOTAL_MULT_WEIGHT = MULTIPLIER_REEL.reduce((sum, m) => sum + m.weight, 0);

/**
 * 5 Fixed Paylines across [reel0Row, reel1Row, reel2Row] (0=top, 1=mid, 2=bottom)
 */
const PAYLINES = [
  { id: 1, name: 'Middle Line',    rows: [1, 1, 1], color: '#facc15' },
  { id: 2, name: 'Top Line',       rows: [0, 0, 0], color: '#f97316' },
  { id: 3, name: 'Bottom Line',    rows: [2, 2, 2], color: '#ef4444' },
  { id: 4, name: 'Diagonal Down',  rows: [0, 1, 2], color: '#38bdf8' },
  { id: 5, name: 'Diagonal Up',    rows: [2, 1, 0], color: '#a855f7' }
];

function roundMoney(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

/**
 * Evaluates a 3x3 reel grid (reels[col][row]) + active companion multiplier (1x-5x).
 */
function evaluateSpin(reels, companionMultiplier, totalBet) {
  const stake = roundMoney(totalBet);
  const mult = Math.max(1, Math.min(5, Number(companionMultiplier) || 1));

  const winningLines = [];
  let baseLineWinSum = 0;

  for (const line of PAYLINES) {
    const [r0, r1, r2] = line.rows;
    const s0 = reels[0][r0];
    const s1 = reels[1][r1];
    const s2 = reels[2][r2];

    if (s0 && s0 === s1 && s1 === s2) {
      const sym = SYMBOLS[s0];
      if (sym) {
        const lineBaseWin = roundMoney(stake * sym.payoutMult);
        const lineBoostedWin = roundMoney(lineBaseWin * mult);
        baseLineWinSum = roundMoney(baseLineWinSum + lineBaseWin);

        winningLines.push({
          lineId: line.id,
          name: line.name,
          rows: line.rows,
          color: line.color,
          symbol: s0,
          symbolName: sym.name,
          basePayoutMult: sym.payoutMult,
          companionMultiplier: mult,
          lineWin: lineBoostedWin
        });
      }
    }
  }

  // Check Full Screen (all 9 positions match same symbol)
  const firstSym = reels[0][0];
  const isFullScreen = Boolean(
    firstSym &&
    reels.every((col) => col.every((cell) => cell === firstSym))
  );

  const totalWin = roundMoney(baseLineWinSum * mult);

  return {
    totalWin,
    baseWin: baseLineWinSum,
    companionMultiplier: mult,
    isFullScreen,
    winningLines,
    totalMultiplier: stake > 0 ? roundMoney(totalWin / stake) : 0
  };
}

function getPaytableForBet(betAmount = 5) {
  const stake = roundMoney(betAmount || 5);
  return {
    bet: stake,
    rtp: 97.05,
    paylinesCount: PAYLINES.length,
    paylines: PAYLINES,
    multiplierOptions: [1, 2, 3, 4, 5],
    items: SYMBOL_LIST.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      basePayoutMult: s.payoutMult,
      lineWinAt1x: roundMoney(stake * s.payoutMult),
      lineWinAt5x: roundMoney(stake * s.payoutMult * 5)
    }))
  };
}

module.exports = {
  BET_PRESETS,
  SYMBOLS,
  SYMBOL_LIST,
  TOTAL_SYMBOL_WEIGHT,
  MULTIPLIER_REEL,
  TOTAL_MULT_WEIGHT,
  PAYLINES,
  roundMoney,
  evaluateSpin,
  getPaytableForBet
};
