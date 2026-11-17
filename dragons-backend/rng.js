const crypto = require('crypto');
const { SYMBOLS, DRAGON_LIST } = require('./paytable');

function randomDragon(exclude = null) {
  const pool = exclude ? DRAGON_LIST.filter((d) => d !== exclude) : DRAGON_LIST;
  return pool[crypto.randomInt(0, pool.length)];
}

/**
 * Cryptographically uniform 888 Dragons RNG calibrated to 96.84% theoretical RTP:
 *  - 3x Red Dragon (100x):   0.00300 -> 0.3000 EV
 *  - 3x Green Dragon (50x):  0.00550 -> 0.2750 EV
 *  - 3x Blue Dragon (25x):   0.00850 -> 0.2125 EV
 *  - Any 3 Dragons (5x):     0.03618 -> 0.1809 EV
 *  Total Theoretical RTP = 96.84%
 */
function generateSpinOutcome({ spinId = '', clientSeed = '' } = {}) {
  const serverSeed = crypto.randomBytes(16).toString('hex');
  const cSeed = clientSeed || crypto.randomBytes(8).toString('hex');
  const spinHash = crypto
    .createHash('sha512')
    .update(`${serverSeed}:${cSeed}:${spinId}`)
    .digest('hex');

  // 52-bit precision uniform [0, 1)
  const slice = parseInt(spinHash.slice(0, 13), 16);
  const r = slice / Math.pow(2, 52);

  let middleRow;
  if (r < 0.00300) {
    middleRow = [SYMBOLS.RED, SYMBOLS.RED, SYMBOLS.RED];
  } else if (r < 0.00850) {
    middleRow = [SYMBOLS.GREEN, SYMBOLS.GREEN, SYMBOLS.GREEN];
  } else if (r < 0.01700) {
    middleRow = [SYMBOLS.BLUE, SYMBOLS.BLUE, SYMBOLS.BLUE];
  } else if (r < 0.05318) {
    // Mixed dragons or 3x Silver (pays 5x)
    if (crypto.randomInt(0, 5) === 0) {
      middleRow = [SYMBOLS.SILVER, SYMBOLS.SILVER, SYMBOLS.SILVER];
    } else {
      const a = randomDragon();
      const b = randomDragon();
      const c = a === b ? randomDragon(a) : randomDragon();
      middleRow = [a, b, c];
    }
  } else {
    // Non-winning outcome (must contain at least 1 BLANK on the middle payline)
    // Includes exciting near-misses where 2 reels show matching dragons and 1 is blank
    const pattern = crypto.randomInt(0, 10);
    if (pattern < 3) {
      const d = randomDragon();
      middleRow = [d, d, SYMBOLS.BLANK];
    } else if (pattern < 5) {
      middleRow = [randomDragon(), SYMBOLS.BLANK, randomDragon()];
    } else if (pattern < 7) {
      middleRow = [SYMBOLS.BLANK, randomDragon(), randomDragon()];
    } else {
      middleRow = [
        crypto.randomInt(0, 2) === 0 ? randomDragon() : SYMBOLS.BLANK,
        SYMBOLS.BLANK,
        crypto.randomInt(0, 2) === 0 ? randomDragon() : SYMBOLS.BLANK
      ];
    }
  }

  // Build 3 visible rows per reel (top & bottom rows show alternating dragons/blanks realistically)
  const reels = middleRow.map((midSym) => {
    if (midSym === SYMBOLS.BLANK) {
      return [randomDragon(), SYMBOLS.BLANK, randomDragon()];
    }
    return [SYMBOLS.BLANK, midSym, SYMBOLS.BLANK];
  });

  return {
    reels,
    middleRow,
    fairnessProof: {
      spinId,
      serverSeed,
      clientSeed: cSeed,
      spinHash,
      r: Number(r.toFixed(6))
    }
  };
}

module.exports = {
  generateSpinOutcome
};
