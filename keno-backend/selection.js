const crypto = require('crypto');

const MIN_NUMBER = 1;
const MAX_NUMBER = 80;
const DRAW_COUNT = 20;
const MIN_PICKS = 1;
const MAX_PICKS = Math.min(15, Math.max(10, Number(process.env.MAX_KENO_PICKS || 10)));

const PAYOUT_TABLE = {
  1: { 1: 3.80 },
  2: { 2: 14.50 },
  3: { 2: 1.98, 3: 50.77 },
  4: { 2: 1.00, 3: 5.50, 4: 85.00 },
  5: { 3: 3.00, 4: 15.00, 5: 300.00 },
  6: { 3: 2.00, 4: 8.00, 5: 50.00, 6: 1000.00 },
  7: { 3: 1.00, 4: 5.00, 5: 20.00, 6: 150.00, 7: 2500.00 },
  8: { 4: 3.00, 5: 12.00, 6: 60.00, 7: 500.00, 8: 5000.00 },
  9: { 4: 2.00, 5: 8.00, 6: 30.00, 7: 200.00, 8: 1500.00, 9: 7500.00 },
  10: { 0: 1.00, 5: 5.00, 6: 20.00, 7: 100.00, 8: 500.00, 9: 2500.00, 10: 10000.00 },
  11: { 0: 1.00, 5: 3.00, 6: 12.00, 7: 55.00, 8: 250.00, 9: 1000.00, 10: 4000.00, 11: 12000.00 },
  12: { 0: 1.00, 5: 2.00, 6: 8.00, 7: 35.00, 8: 150.00, 9: 600.00, 10: 2500.00, 11: 6000.00, 12: 15000.00 },
  13: { 0: 1.00, 6: 5.00, 7: 20.00, 8: 80.00, 9: 350.00, 10: 1500.00, 11: 4000.00, 12: 8000.00, 13: 20000.00 },
  14: { 0: 1.00, 6: 4.00, 7: 15.00, 8: 50.00, 9: 200.00, 10: 800.00, 11: 2500.00, 12: 6000.00, 13: 12000.00, 14: 25000.00 },
  15: { 0: 1.00, 6: 3.00, 7: 10.00, 8: 35.00, 9: 150.00, 10: 500.00, 11: 1500.00, 12: 4000.00, 13: 8000.00, 14: 15000.00, 15: 30000.00 }
};

function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Validates player number picks: must contain unique integers in [1, 80]
 * with count between MIN_PICKS and maxPicks.
 */
function validatePicks(rawPicks, maxPicks = MAX_PICKS) {
  if (!Array.isArray(rawPicks)) {
    return { valid: false, error: 'Picks must be an array of numbers.', picks: [] };
  }

  const normalized = [];
  const seen = new Set();

  for (const item of rawPicks) {
    const num = Number(item);
    if (!Number.isInteger(num) || num < MIN_NUMBER || num > MAX_NUMBER) {
      return {
        valid: false,
        error: `Invalid number "${item}". Choose integers between ${MIN_NUMBER} and ${MAX_NUMBER}.`,
        picks: []
      };
    }
    if (seen.has(num)) {
      return { valid: false, error: `Duplicate number ${num} is not allowed.`, picks: [] };
    }
    seen.add(num);
    normalized.push(num);
  }

  if (normalized.length < MIN_PICKS || normalized.length > maxPicks) {
    return {
      valid: false,
      error: `Select between ${MIN_PICKS} and ${maxPicks} numbers.`,
      picks: []
    };
  }

  return { valid: true, error: null, picks: normalized };
}

/**
 * Unbiased Fisher-Yates Shuffle using Node crypto.randomInt
 * Guarantees unique numbers per draw.
 */
function fisherYatesDraw(count = DRAW_COUNT, min = MIN_NUMBER, max = MAX_NUMBER) {
  const pool = [];
  for (let n = min; n <= max; n++) {
    pool.push(n);
  }

  for (let i = pool.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }

  return pool.slice(0, Math.min(count, pool.length));
}

function autoPickNumbers(count = 5, maxPicks = MAX_PICKS) {
  const safeCount = Math.min(maxPicks, Math.max(MIN_PICKS, Number(count) || 5));
  return fisherYatesDraw(safeCount, MIN_NUMBER, MAX_NUMBER);
}

function getPayoutTableForCount(pickCount) {
  return PAYOUT_TABLE[Number(pickCount)] || {};
}

function getMultiplier(pickCount, hitCount) {
  const table = getPayoutTableForCount(pickCount);
  return Number(table[hitCount] || 0);
}

function calculatePossibleMaxWin(pickCount, betAmount) {
  const table = getPayoutTableForCount(pickCount);
  const values = Object.values(table);
  if (values.length === 0) return 0;
  const maxMult = Math.max(...values);
  return roundCurrency((Number(betAmount) || 0) * maxMult);
}

function evaluateTicket(picks, drawnNumbers, betAmount) {
  const drawnSet = new Set(drawnNumbers);
  const hits = picks.filter((n) => drawnSet.has(n));
  const hitCount = hits.length;
  const multiplier = getMultiplier(picks.length, hitCount);
  const winAmount = roundCurrency((Number(betAmount) || 0) * multiplier);

  return {
    hits,
    hitCount,
    multiplier,
    winAmount,
    won: winAmount > 0
  };
}

function computeStatistics(rounds, windowSize = 100) {
  const recent = Array.isArray(rounds) ? rounds.slice(0, windowSize) : [];
  const counts = new Array(MAX_NUMBER + 1).fill(0);

  for (const r of recent) {
    const nums = Array.isArray(r.nums) ? r.nums : [];
    for (const n of nums) {
      if (n >= MIN_NUMBER && n <= MAX_NUMBER) {
        counts[n] += 1;
      }
    }
  }

  const stats = [];
  for (let num = MIN_NUMBER; num <= MAX_NUMBER; num++) {
    stats.push({ num, count: counts[num] });
  }

  const sortedByFreq = [...stats].sort((a, b) => b.count - a.count || a.num - b.num);
  const hotNumbers = sortedByFreq.slice(0, 7).map((s) => s.num);
  const coldNumbers = sortedByFreq.slice(-6).reverse().map((s) => s.num);

  return {
    roundsAnalyzed: recent.length,
    stats,
    hotNumbers,
    coldNumbers
  };
}

module.exports = {
  MIN_NUMBER,
  MAX_NUMBER,
  DRAW_COUNT,
  MIN_PICKS,
  MAX_PICKS,
  PAYOUT_TABLE,
  roundCurrency,
  validatePicks,
  fisherYatesDraw,
  autoPickNumbers,
  getPayoutTableForCount,
  getMultiplier,
  calculatePossibleMaxWin,
  evaluateTicket,
  computeStatistics
};
