const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

const { MultiHot5Engine } = require('./engine');
const { getPaytableForBet } = require('./paytable');

function resolveHtmlPath() {
  const candidates = [
    path.join(__dirname, 'index.html'),
    path.join(__dirname, 'public', 'index.html'),
    path.join(__dirname, '..', 'index.html'),
    path.join(__dirname, '..', 'dist', 'index.html')
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/**
 * Attaches Multi Hot 5 REST API routes (/api/multihot5/*) onto an Express app.
 * Works standalone on Render (`node app.js`) or mounted inside server.ts.
 */
function createMultiHot5App({ app: existingApp, serveStaticHtml = true } = {}) {
  const app = existingApp || express();

  if (!existingApp) {
    app.use(cors());
    app.use(express.json({ limit: '2mb' }));
  }

  const engine = new MultiHot5Engine();
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      game: 'MULTI_HOT_5',
      rtp: 97.05,
      paylines: 5,
      spinsProcessed: engine.spinSeq - 1000
    });
  });

  router.get('/state', (req, res) => {
    const playerId = String(req.query.playerId || req.get('X-Player-Id') || 'mh5_guest');
    const displayName = String(req.query.displayName || '');
    const state = engine.getPlayerState(playerId, displayName);
    const bet = Number(req.query.bet || 5);
    res.json({
      status: 'success',
      ...state,
      paytable: getPaytableForBet(bet)
    });
  });

  router.get('/paytable', (req, res) => {
    const bet = Number(req.query.bet || 5);
    res.json({
      status: 'success',
      ...getPaytableForBet(bet)
    });
  });

  router.post('/spin', (req, res) => {
    const { playerId, bet, clientSeed, displayName } = req.body || {};
    const uid = String(playerId || req.get('X-Player-Id') || 'mh5_guest');
    const result = engine.spin({
      playerId: uid,
      bet,
      clientSeed,
      displayName
    });

    if (!result.ok) {
      return res.status(400).json({
        status: 'error',
        code: result.code || 'SPIN_ERROR',
        message: result.error,
        balance: result.balance
      });
    }

    res.json({
      status: 'success',
      ...result
    });
  });

  router.post('/gamble', (req, res) => {
    const { playerId, choice } = req.body || {};
    const uid = String(playerId || req.get('X-Player-Id') || 'mh5_guest');
    const result = engine.gamble({ playerId: uid, choice });
    if (!result.ok) {
      return res.status(400).json({
        status: 'error',
        message: result.error,
        balance: result.balance
      });
    }
    res.json({
      status: 'success',
      ...result
    });
  });

  router.post('/collect', (req, res) => {
    const uid = String(req.body?.playerId || req.get('X-Player-Id') || 'mh5_guest');
    const result = engine.collect({ playerId: uid });
    res.json({
      status: 'success',
      ...result
    });
  });

  router.post('/bonus', (req, res) => {
    const uid = String(req.body?.playerId || req.get('X-Player-Id') || 'mh5_guest');
    const amount = Number(req.body?.amount || 500);
    const result = engine.balanceManager.addBonusCredit(uid, amount);
    res.json({
      status: 'success',
      ...result
    });
  });

  router.get('/history', (req, res) => {
    const uid = String(req.query.playerId || req.get('X-Player-Id') || 'mh5_guest');
    res.json({
      status: 'success',
      history: engine.balanceManager.getHistory(uid, 30),
      recentGlobalWins: engine.globalWins.slice(0, 15),
      biggestWin: engine.biggestWin
    });
  });

  app.use('/api/multihot5', router);

  if (serveStaticHtml) {
    const htmlPath = resolveHtmlPath();
    if (htmlPath) {
      app.use(express.static(path.dirname(htmlPath)));
      app.get('/', (_req, res) => {
        res.sendFile(htmlPath);
      });
    }
  }

  return { app, engine };
}

function startServer(port = process.env.PORT || 3000) {
  const { app, engine } = createMultiHot5App({ serveStaticHtml: true });
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Multi Hot 5 Server running on port ${port}`);
  });
  return { app, server, engine };
}

if (require.main === module) {
  startServer(process.env.PORT || 3000);
}

module.exports = {
  createMultiHot5App,
  startServer
};
