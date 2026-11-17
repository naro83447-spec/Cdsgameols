const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const { AviatorGameRoom } = require('./gameroom');

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
 * Attaches Aviator Socket.IO + /api/aviator/* routes onto an Express app & HTTP server.
 * Works standalone on Render (`node app.js`) or mounted inside server.ts.
 */
function createAviatorApp({ app: existingApp, httpServer: existingHttpServer, io: existingIo, serveStaticHtml = true } = {}) {
  const app = existingApp || express();
  const httpServer = existingHttpServer || http.createServer(app);

  if (!existingApp) {
    app.use(cors());
    app.use(express.json({ limit: '2mb' }));
  }

  const io = existingIo || new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });

  const gameRoom = new AviatorGameRoom();
  gameRoom.attachSocketIO(io);
  gameRoom.start();

  const router = express.Router();

  router.get('/health', (_req, res) => {
    const round = gameRoom.engine.currentRound;
    res.json({
      ok: true,
      game: 'AVIATOR',
      roundId: round ? round.roundId : null,
      phase: round ? round.phase : null,
      multiplier: round ? round.multiplier : 1.00,
      connectedSockets: io.engine ? io.engine.clientsCount : 0
    });
  });

  router.get('/state', (req, res) => {
    const playerId = String(req.query.playerId || req.get('X-Player-Id') || 'p_guest');
    res.json({
      status: 'success',
      ...gameRoom.getSnapshot(playerId)
    });
  });

  router.post('/bet', (req, res) => {
    const { playerId, panelId, amount, autoCashOut, clientSeed, displayName, avatarSeed } = req.body || {};
    const uid = String(playerId || req.get('X-Player-Id') || 'p_guest');
    const result = gameRoom.placeBet({
      playerId: uid,
      panelId,
      amount,
      autoCashOut,
      clientSeed,
      displayName,
      avatarSeed
    });
    if (!result.ok) {
      return res.status(400).json({ status: 'error', message: result.error, balance: result.balance });
    }
    res.json({ status: 'success', ...result });
  });

  router.post('/cancel', (req, res) => {
    const { playerId, panelId } = req.body || {};
    const uid = String(playerId || req.get('X-Player-Id') || 'p_guest');
    const result = gameRoom.cancelBet({ playerId: uid, panelId });
    if (!result.ok) {
      return res.status(400).json({ status: 'error', message: result.error });
    }
    res.json({ status: 'success', ...result });
  });

  router.post('/cashout', (req, res) => {
    const { playerId, panelId } = req.body || {};
    const uid = String(playerId || req.get('X-Player-Id') || 'p_guest');
    const result = gameRoom.cashOut({ playerId: uid, panelId });
    if (!result.ok) {
      return res.status(400).json({ status: 'error', message: result.error });
    }
    res.json({ status: 'success', ...result });
  });

  router.post('/topup', (req, res) => {
    const uid = String(req.body?.playerId || req.get('X-Player-Id') || 'p_guest');
    const amount = Number(req.body?.amount || 100);
    const result = gameRoom.balanceManager.topUp(uid, amount);
    res.json({ status: 'success', ...result });
  });

  router.get('/history', (req, res) => {
    const uid = String(req.query.playerId || req.get('X-Player-Id') || 'p_guest');
    res.json({
      status: 'success',
      betHistory: gameRoom.balanceManager.getBetHistory(uid, 50),
      roundHistory: gameRoom.history
    });
  });

  router.get('/top', (_req, res) => {
    res.json({
      status: 'success',
      topWinners: gameRoom.topWinners
    });
  });

  router.get('/fairness/:roundId', (req, res) => {
    const proof = gameRoom.getFairnessProof(req.params.roundId);
    res.json({
      status: 'success',
      proof
    });
  });

  app.use('/api/aviator', router);

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
  const { app, httpServer, io, gameRoom } = createAviatorApp({ serveStaticHtml: true });
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Aviator Game Server running on port ${port}`);
  });
  return { app, httpServer, io, gameRoom };
}

if (require.main === module) {
  startServer(process.env.PORT || 3000);
}

module.exports = {
  createAviatorApp,
  startServer
};
