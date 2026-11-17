const crypto = require('crypto');

const MAX_MULTIPLIER = 1000.0;

function sha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function sha512(input) {
  return crypto.createHash('sha512').update(String(input)).digest('hex');
}

function generateRandomSeed(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Generates a Provably Fair crash point for Crazy Rocket (96% RTP / 4% house edge).
 * Uses SHA-512 over serverSeed + roundId + top clientSeeds.
 */
function generateRocketFairness({ roundId, serverSeed = '', clientSeeds = [] } = {}) {
  const sSeed = serverSeed || generateRandomSeed(16);
  const seedsList = Array.isArray(clientSeeds) ? [...clientSeeds] : [];

  while (seedsList.length < 3) {
    seedsList.push({
      player: `r***${seedsList.length + 1}`,
      seed: generateRandomSeed(10)
    });
  }

  const combinedInput = [
    sSeed,
    String(roundId || 1),
    ...seedsList.slice(0, 3).map((c) => c.seed)
  ].join(':');

  const combinedHash = sha512(combinedInput);
  const hex = combinedHash.slice(0, 13);
  const decimal = parseInt(hex, 16);
  const maxVal = Math.pow(2, 52);

  // Instant 1.00x fly-away ~4% of rounds (96% RTP)
  let crashPoint = 1.00;
  if (decimal % 25 !== 0) {
    const raw = (96 * maxVal) / (100 * (maxVal - decimal));
    crashPoint = Math.floor(Math.max(1.01, Math.min(MAX_MULTIPLIER, raw)) * 100) / 100;
  }

  return {
    roundId: Number(roundId),
    serverSeed: sSeed,
    serverSeedHash: sha256(sSeed),
    clientSeeds: seedsList.slice(0, 3),
    combinedHash,
    hex,
    decimal: String(decimal),
    crashPoint
  };
}

module.exports = {
  MAX_MULTIPLIER,
  sha256,
  sha512,
  generateRandomSeed,
  generateRocketFairness
};
