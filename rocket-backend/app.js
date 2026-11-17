const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const { RocketGameRoom } = require('./gameroom');

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
 * Attaches Crazy Rocket Socket.IO namespace (/rocket) + /api/rocket/* routes.
 * Works standalone on Render (`node app.js`) or mounted inside server.ts.
 */
function createRocketApp({ app: existingApp, httpServer: existingHttpServer, io: existingIo, namespace = '/rocket', serveStaticHtml = true } = {}) {
  const app = existingApp || express();
  const httpServer = existingHttpServer || http.createServer(app);

  if (!existingApp) {
    app.use(cors());
    app.use(express.json({ limit: '2mb' }));
  }

  const io = existingIo || new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });

  const targetNamespace = namespace ? io.of(namespace) : io;
  const gameRoom = new RocketGameRoom();
  gameRoom.attachSocketIO(targetNamespace);
  gameRoom.start();

  const router = express.Router();

  router.get('/health', (_req, res) => {
    const round = gameRoom.engine.currentRound;
    res.json({
      ok: true,
      game: 'CRAZY_ROCKET',
      namespace: namespace || '/',
      roundId: round ? round.roundId : null,
      phase: round ? round.phase : null,
      multiplier: round ? round.multiplier : 1.00,
      connectedSockets: targetNamespace.sockets ? targetNamespace.sockets.size : 0
    });
  });

  router.get('/state', (req, res) => {
    const playerId = String(req.query.playerId || req.get('X-Player-Id') || 'rocket_guest');
    res.json({
      status: 'success',
      ...gameRoom.getSnapshot(playerId)
    });
  });

  router.post('/bet', (req, res) => {
    const { playerId, panelId, amount, autoCashout, autoCashoutVal, clientSeed, displayName } = req.body || {};
    const uid = String(playerId || req.get('X-Player-Id') || 'rocket_guest');
    const result = gameRoom.placeBet({
      playerId: uid,
      panelId,
      amount,
      autoCashout,
      autoCashoutVal,
      clientSeed,
      displayName
    });
    if (!result.ok) {
      return res.status(400).json({ status: 'error', message: result.error, balance: result.balance });
    }
    res.json({ status: 'success', ...result });
  });

  router.post('/cancel', (req, res) => {
    const { playerId, panelId } = req.body || {};
    const uid = String(playerId || req.get('X-Player-Id') || 'rocket_guest');
    const result = gameRoom.cancelBet({ playerId: uid, panelId });
    if (!result.ok) {
      return res.status(400).json({ status: 'error', message: result.error });
    }
    res.json({ status: 'success', ...result });
  });

  router.post('/cashout', (req, res) => {
    const { playerId, panelId } = req.body || {};
    const uid = String(playerId || req.get('X-Player-Id') || 'rocket_guest');
    const result = gameRoom.cashOut({ playerId: uid, panelId });
    if (!result.ok) {
      return res.status(400).json({ status: 'error', message: result.error });
    }
    res.json({ status: 'success', ...result });
  });

  router.post('/bonus', (req, res) => {
    const uid = String(req.body?.playerId || req.get('X-Player-Id') || 'rocket_guest');
    const amount = Number(req.body?.amount || 500);
    const result = gameRoom.balanceManager.addBonusBalance(uid, amount);
    gameRoom._emitToPlayer(uid, 'player:sync', { balance: result.balance });
    res.json({ status: 'success', ...result });
  });

  router.get('/history', (req, res) => {
    const uid = String(req.query.playerId || req.get('X-Player-Id') || 'rocket_guest');
    res.json({
      status: 'success',
      betHistory: gameRoom.balanceManager.getBetHistory(uid, 50),
      roundHistory: gameRoom.history
    });
  });

  router.get('/players', (req, res) => {
    const uid = String(req.query.playerId || req.get('X-Player-Id') || '');
    const round = gameRoom.engine.currentRound;
    res.json({
      status: 'success',
      roundId: round ? round.roundId : null,
      players: round ? round.getLivePlayersRows(uid) : []
    });
  });

  router.get('/stats', (_req, res) => {
    res.json({
      status: 'success',
      stats: gameRoom.stats
    });
  });

  router.get('/fairness/:roundId', (req, res) => {
    res.json({
      status: 'success',
      proof: gameRoom.getFairnessProof(req.params.roundId)
    });
  });

  app.use('/api/rocket', router);

  if (serveStaticHtml) {
    const htmlPath = resolveHtmlPath();
    if (htmlPath) {
      app.use(express.static(path.dirname(htmlPath)));
      app.get('/', (_req, res) => {
        res.sendFile(htmlPath);
      });
    }
  }

  return { app, httpServer, io, gameRoom };
}

function startServer(port = process.env.PORT || 3000) {
  const { app, httpServer, io, gameRoom } = createRocketApp({ serveStaticHtml: true });
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Crazy Rocket Server running on port ${port}`);
  });
  return { app, httpServer, io, gameRoom };
}

if (require.main === module) {
  startServer(process.env.PORT || 3000);
}

module.exports = {
  createRocketApp,
  startServer
};
