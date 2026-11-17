const { roundMoney } = require('./balance');

const SYMBOLS = {
  RED: '🐉',
  GREEN: '🐲',
  BLUE: '🇨',
  SILVER: '🥈',
  BLANK: ''
};

const DRAGON_LIST = [SYMBOLS.RED, SYMBOLS.GREEN, SYMBOLS.BLUE, SYMBOLS.SILVER];

const MULTIPLIERS = {
  RED_3: 100,
  GREEN_3: 50,
  BLUE_3: 25,
  ANY_3: 5
};

const BET_PRESETS = [1.00, 2.00, 5.00, 10.00, 25.00, 50.00, 100.00];

function evaluatePayline(middleRow, betAmount) {
  const [s1, s2, s3] = middleRow;
  const bet = roundMoney(betAmount);

  if (!s1 || !s2 || !s3) {
    return { winAmount: 0, multiplier: 0, winType: 'NONE', label: 'No Win' };
  }

  if (s1 === SYMBOLS.RED && s2 === SYMBOLS.RED && s3 === SYMBOLS.RED) {
    return {
      winAmount: roundMoney(bet * MULTIPLIERS.RED_3),
      multiplier: MULTIPLIERS.RED_3,
      winType: 'RED_3',
      label: '3x Red Dragon'
    };
  }

  if (s1 === SYMBOLS.GREEN && s2 === SYMBOLS.GREEN && s3 === SYMBOLS.GREEN) {
    return {
      winAmount: roundMoney(bet * MULTIPLIERS.GREEN_3),
      multiplier: MULTIPLIERS.GREEN_3,
      winType: 'GREEN_3',
      label: '3x Green Dragon'
    };
  }

  if (s1 === SYMBOLS.BLUE && s2 === SYMBOLS.BLUE && s3 === SYMBOLS.BLUE) {
    return {
      winAmount: roundMoney(bet * MULTIPLIERS.BLUE_3),
      multiplier: MULTIPLIERS.BLUE_3,
      winType: 'BLUE_3',
      label: '3x Blue Dragon'
    };
  }

  if (DRAGON_LIST.includes(s1) && DRAGON_LIST.includes(s2) && DRAGON_LIST.includes(s3)) {
    return {
      winAmount: roundMoney(bet * MULTIPLIERS.ANY_3),
      multiplier: MULTIPLIERS.ANY_3,
      winType: 'ANY_3',
      label: 'Any 3 Dragons'
    };
  }

  return { winAmount: 0, multiplier: 0, winType: 'NONE', label: 'No Win' };
}

function getPaytableForBet(betAmount) {
  const bet = roundMoney(betAmount);
  return {
    bet,
    rtp: 96.84,
    payouts: [
      { id: 'RED_3', symbol: SYMBOLS.RED, title: '3x Red Dragon', mult: MULTIPLIERS.RED_3, payout: roundMoney(bet * MULTIPLIERS.RED_3) },
      { id: 'GREEN_3', symbol: SYMBOLS.GREEN, title: '3x Green Dragon', mult: MULTIPLIERS.GREEN_3, payout: roundMoney(bet * MULTIPLIERS.GREEN_3) },
      { id: 'BLUE_3', symbol: SYMBOLS.BLUE, title: '3x Blue Dragon', mult: MULTIPLIERS.BLUE_3, payout: roundMoney(bet * MULTIPLIERS.BLUE_3) },
      { id: 'ANY_3', symbol: SYMBOLS.SILVER, title: 'ANY 3 Dragons', mult: MULTIPLIERS.ANY_3, payout: roundMoney(bet * MULTIPLIERS.ANY_3) }
    ]
  };
}

module.exports = {
  SYMBOLS,
  DRAGON_LIST,
  MULTIPLIERS,
  BET_PRESETS,
  evaluatePayline,
  getPaytableForBet
};
