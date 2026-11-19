const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const { AviatorGameRoom } = require('./gameroom');
const { requireFirebaseUser, getAuth } = require('../shared/firebase-admin');
const aviatorWallet = require('./firestore-wallet');

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

  const allowedOrigins = String(process.env.CORS_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean);

  if (!existingApp) {
    app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false }));
    app.use(express.json({ limit: '2mb' }));
  }

  const io = existingIo || new Server(httpServer, {
    cors: { origin: allowedOrigins.length ? allowedOrigins : false, methods: ['GET', 'POST'] }
  });

  // Aviator gets its own namespace so its Firebase auth requirement does not break other games.
  const aviatorIo = io.of('/aviator');
  aviatorIo.use(async (socket, next) => {
    try {
      const token = String(socket.handshake.auth && socket.handshake.auth.idToken || '');
      if (!token) return next(new Error('Firebase sign-in required.'));
      const decoded = await getAuth().verifyIdToken(token, true);
      socket.data.uid = decoded.uid;
      return next();
    } catch (_error) {
      return next(new Error('Invalid or expired Firebase sign-in.'));
    }
  });

  const initialRoundId = Number(process.env.AVIATOR_INITIAL_ROUND_ID || (Date.now() + Math.floor(Math.random() * 1000)));
  const gameRoom = new AviatorGameRoom({ initialRoundId });
  gameRoom.attachSocketIO(aviatorIo);
  const firebaseConfigured = Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
  );
  if (firebaseConfigured) {
    gameRoom.start();
  } else {
    console.warn('[aviator] engine remains stopped until Firebase Admin credentials are configured.');
  }

  const router = express.Router();

  // Fail closed: legacy in-memory wallet actions are not approved for real-money play.
  router.use((req, res, next) => {
    if (req.method === 'POST' && ['/bet', '/cancel', '/cashout', '/topup'].includes(req.path)) {
      return res.status(503).json({ status: 'error', message: 'Aviator wagering is disabled pending the secure Firestore wallet migration.' });
    }
    return next();
  });

  router.get('/health', (_req, res) => {
    const round = gameRoom.engine.currentRound;
    res.json({
      ok: true,
      game: 'AVIATOR',
      roundId: round ? round.roundId : null,
      phase: round ? round.phase : null,
      multiplier: round ? round.multiplier : 1.00,
      connectedSockets: aviatorIo.sockets.size
    });
  });

  router.get('/state', requireFirebaseUser, async (req, res, next) => {
    try {
      const snapshot = gameRoom.getSnapshot(req.user.uid);
      const wallet = await aviatorWallet.ensureWallet(req.user.uid);
      snapshot.player.balance = wallet.balance;
      res.json({ status: 'success', ...snapshot });
    } catch (error) { next(error); }
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

  router.get('/history', requireFirebaseUser, async (req, res, next) => {
    try {
      const [betHistory, roundHistory] = await Promise.all([
        aviatorWallet.getBetHistory(req.user.uid, 50),
        aviatorWallet.getRoundHistory(42)
      ]);
      res.json({ status: 'success', betHistory, roundHistory });
    } catch (error) { next(error); }
  });

  router.get('/top', (_req, res) => {
    res.json({
      status: 'success',
      topWinners: gameRoom.topWinners
    });
  });

  router.get('/fairness/:roundId', async (req, res, next) => {
    try {
      const proof = await aviatorWallet.getRoundProof(req.params.roundId);
      res.json({ status: 'success', proof });
    } catch (error) { next(error); }
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

  return { app, httpServer, io, aviatorIo, gameRoom };
}

function startServer(port = process.env.PORT || 3000) {
  const { app, httpServer, io, aviatorIo, gameRoom } = createAviatorApp({ serveStaticHtml: true });
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Aviator Game Server running on port ${port}`);
  });
  return { app, httpServer, io, aviatorIo, gameRoom };
}

if (require.main === module) {
  startServer(process.env.PORT || 3000);
}

module.exports = {
  createAviatorApp,
  startServer
};
