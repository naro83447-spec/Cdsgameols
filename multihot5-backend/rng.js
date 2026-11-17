const crypto = require('crypto');
const {
  SYMBOL_LIST,
  TOTAL_SYMBOL_WEIGHT,
  MULTIPLIER_REEL,
  TOTAL_MULT_WEIGHT
} = require('./paytable');

function drawWeightedSymbol() {
  const roll = crypto.randomInt(0, TOTAL_SYMBOL_WEIGHT);
  let cursor = 0;
  for (const sym of SYMBOL_LIST) {
    cursor += sym.weight;
    if (roll < cursor) return sym.id;
  }
  return 'CHERRY';
}

function drawCompanionMultiplier() {
  const roll = crypto.randomInt(0, TOTAL_MULT_WEIGHT);
  let cursor = 0;
  for (const item of MULTIPLIER_REEL) {
    cursor += item.weight;
    if (roll < cursor) return item.mult;
  }
  return 1;
}

function generateSpinOutcome({ spinId, clientSeed = '' } = {}) {
  const reels = [
    [drawWeightedSymbol(), drawWeightedSymbol(), drawWeightedSymbol()],
    [drawWeightedSymbol(), drawWeightedSymbol(), drawWeightedSymbol()],
    [drawWeightedSymbol(), drawWeightedSymbol(), drawWeightedSymbol()]
  ];

  const companionMultiplier = drawCompanionMultiplier();
  const serverSeed = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .createHash('sha256')
    .update(`${serverSeed}:${spinId || Date.now()}:${clientSeed}:${companionMultiplier}:${reels.flat().join(',')}`)
    .digest('hex');

  return {
    reels,
    companionMultiplier,
    fairnessProof: {
      spinId: String(spinId || ''),
      serverSeedHash: hash,
      serverSeed
    }
  };
}

const SUITS = [
  { suit: 'HEARTS',   glyph: '♥', color: 'RED' },
  { suit: 'DIAMONDS', glyph: '♦', color: 'RED' },
  { suit: 'SPADES',   glyph: '♠', color: 'BLACK' },
  { suit: 'CLUBS',    glyph: '♣', color: 'BLACK' }
];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function drawGambleCard(playerChoice) {
  const normalized = String(playerChoice || '').toUpperCase() === 'RED' ? 'RED' : 'BLACK';
  const suitObj = SUITS[crypto.randomInt(0, SUITS.length)];
  const rank = RANKS[crypto.randomInt(0, RANKS.length)];
  const won = suitObj.color === normalized;

  return {
    rank,
    suit: suitObj.suit,
    glyph: suitObj.glyph,
    cardColor: suitObj.color,
    playerChoice: normalized,
    won
  };
}

module.exports = {
  drawWeightedSymbol,
  drawCompanionMultiplier,
  generateSpinOutcome,
  drawGambleCard
};
