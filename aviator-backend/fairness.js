const crypto = require('crypto');

const HOUSE_EDGE_RTP = 97; // 97% RTP
const MAX_MULTIPLIER = 1000.0;

function generateRandomSeed(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

function sha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function sha512(input) {
  return crypto.createHash('sha512').update(String(input)).digest('hex');
}

/**
 * Generates a Provably Fair crash point using SHA-512(serverSeed + 3 clientSeeds)
 * Returns full verification artifacts: serverSeed, serverSeedHash, clientSeeds, combinedHash, hex, decimal, crashPoint
 */
function generateRoundFairness({ roundId, serverSeed, clientSeeds = [] }) {
  const safeServerSeed = serverSeed || generateRandomSeed(16);

  // Ensure exactly 3 client seeds (using actual top-3 bettors or fallback seeds)
  const seeds = [];
  for (let i = 0; i < 3; i++) {
    if (clientSeeds[i] && clientSeeds[i].seed) {
      seeds.push({
        player: clientSeeds[i].player || `Player${i + 1}`,
        seed: String(clientSeeds[i].seed)
      });
    } else {
      const names = ['No bettor', 'No bettor', 'No bettor'];
      seeds.push({
        player: names[i],
        seed: generateRandomSeed(10)
      });
    }
  }

  const combinedInput = `${safeServerSeed}:${seeds.map((s) => s.seed).join(':')}:${roundId}`;
  const combinedHash = sha512(combinedInput);

  // First 13 hex characters = 52 bits precision
  const hex = combinedHash.slice(0, 13);
  const decimal = parseInt(hex, 16);
  const e = Math.pow(2, 52);

  // 3% instant crash house edge (97% RTP)
  let crashPoint;
  if (decimal % 33 === 0) {
    crashPoint = 1.00;
  } else {
    const raw = (HOUSE_EDGE_RTP * e) / (e - decimal);
    crashPoint = Math.floor(raw) / 100;
    crashPoint = Math.min(MAX_MULTIPLIER, Math.max(1.01, Number(crashPoint.toFixed(2))));
  }

  return {
    roundId,
    serverSeed: safeServerSeed,
    serverSeedHash: sha256(safeServerSeed),
    clientSeeds: seeds,
    combinedHash,
    hex,
    decimal: String(decimal),
    crashPoint
  };
}

module.exports = {
  HOUSE_EDGE_RTP,
  MAX_MULTIPLIER,
  generateRandomSeed,
  sha256,
  sha512,
  generateRoundFairness
};
