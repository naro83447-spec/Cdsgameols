const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const selection = require('./selection');
const { GameRoom } = require('./gameroom');

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
 * Attaches Fast Keno REST API routes and Socket.IO room onto an Express app + HTTP server.
 * Works both standalone (node app.js on Render) and mounted inside Vite/server.ts.
 */
function createKenoApp({ app: existingApp, httpServer: existingHttpServer, io: existingIo, namespace = '/keno', serveStaticHtml = true } = {}) {
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
  const gameRoom = new GameRoom();
  gameRoom.attachSocketIO(targetNamespace);
  gameRoom.start();

  const router = express.Router();

  router.get('/health', (req, res) => {
    const round = gameRoom.engine.currentRound;
    res.json({
      ok: true,
      game: 'CLASSIC_KENO',
      namespace: namespace || '/',
      roundId: round ? round.roundId : null,
      phase: round ? round.phase : null,
      connectedSockets: targetNamespace.sockets ? targetNamespace.sockets.size : 0
    });
  });

  router.get('/state', (req, res) => {
    const playerId = String(req.query.playerId || req.get('X-Player-Id') || 'guest_default');
    res.json({
      status: 'success',
      ...gameRoom.getSnapshot(playerId)
    });
  });

  router.post('/bet', (req, res) => {
    const { playerId, displayName, picks, betAmount } = req.body || {};
    const uid = String(playerId || req.get('X-Player-Id') || 'guest_default');
    const result = gameRoom.placeBet({
      playerId: uid,
      displayName,
      picks,
      betAmount
    });

    if (!result.ok) {
      return res.status(400).json({ status: 'error', message: result.error, balance: result.balance });
    }

    res.json({
      status: 'success',
      ticket: result.ticket,
      tickets: result.tickets,
      balance: result.balance,
      allBetsCount: result.allBetsCount
    });
  });

  router.post('/autopick', (req, res) => {
    const count = Number(req.body?.count || 5);
    res.json({
      status: 'success',
      picks: selection.autoPickNumbers(count)
    });
  });

  router.post('/topup', (req, res) => {
    const uid = String(req.body?.playerId || req.get('X-Player-Id') || 'guest_default');
    const amount = Number(req.body?.amount || 100);
    const result = gameRoom.balanceManager.topUp(uid, amount);
    gameRoom._emitToPlayer(uid, 'balance:update', { balance: result.balance });
    res.json({ status: 'success', ...result });
  });

  router.get('/history', (req, res) => {
    const uid = String(req.query.playerId || req.get('X-Player-Id') || 'guest_default');
    res.json({
      status: 'success',
      history: gameRoom.balanceManager.getHistory(uid, 50)
    });
  });

  router.get('/results', (req, res) => {
    res.json({
      status: 'success',
      results: gameRoom.pastResults.slice(0, 40)
    });
  });

  router.get('/statistics', (req, res) => {
    const bundle = gameRoom._getStatsBundle();
    res.json({
      status: 'success',
      ...bundle
    });
  });

  router.get('/leaders', (req, res) => {
    res.json({
      status: 'success',
      leaders: gameRoom.balanceManager.getLeaders(20)
    });
  });

  app.use('/api/keno', router);

  if (serveStaticHtml) {
    const htmlPath = resolveHtmlPath();
    if (htmlPath) {
      app.use(express.static(path.dirname(htmlPath)));
      app.get('/', (req, res) => {
        res.sendFile(htmlPath);
      });
    }
  }

  return { app, httpServer, io, gameRoom };
}

function startServer(port = process.env.PORT || 3000) {
  const { app, httpServer, io, gameRoom } = createKenoApp({ serveStaticHtml: true });
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Fast Keno Server running on port ${port}`);
  });
  return { app, httpServer, io, gameRoom };
}

if (require.main === module) {
  startServer(process.env.PORT || 3000);
}

module.exports = {
  createKenoApp,
  startServer
};
