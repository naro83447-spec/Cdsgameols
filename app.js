const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

const { attachSecureWalletRoutes } = require('./shared/secure-wallet-routes');
const { createAviatorApp } = require('./aviator-backend/app');
const { createJetXApp } = require('./jetx-backend/app');
const { createDragonsApp } = require('./dragons-backend/app');
const { createKenoApp } = require('./keno-backend/app');
const { createRocketApp } = require('./rocket-backend/app');
const { createMultiHot5App } = require('./multihot5-backend/app');

function startPlatformServer(port = Number(process.env.PORT || 3000)) {
  const app = express();
  const httpServer = http.createServer(app);

  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'lite-games-platform' }));

  // Wallet APIs require a verified Firebase ID token; deposits remain pending until admin approval.
  attachSecureWalletRoutes(app);

  // 2. Mount all 6 Game Backends sharing the same Socket.IO server & Unified Wallet
  const { io } = createAviatorApp({
    app,
    httpServer,
    serveStaticHtml: false
  });

  createJetXApp({
    app,
    httpServer,
    io,
    namespace: '/jetx',
    serveStaticHtml: false
  });

  createDragonsApp({
    app,
    serveStaticHtml: false
  });

  createKenoApp({
    app,
    httpServer,
    io,
    namespace: '/keno',
    serveStaticHtml: false
  });

  createRocketApp({
    app,
    httpServer,
    io,
    namespace: '/rocket',
    serveStaticHtml: false
  });

  createMultiHot5App({
    app,
    serveStaticHtml: false
  });

  // 3. Static Games, Custom Logos & Lite Games Homepage
  const gamesDir = path.join(__dirname, 'public', 'games');
  if (fs.existsSync(gamesDir)) {
    app.use('/games', express.static(gamesDir));
  }

  const logosDir = path.join(__dirname, 'public', 'logos');
  if (fs.existsSync(logosDir)) {
    app.use('/logos', express.static(logosDir));
  }

  const rootIndex = path.join(__dirname, 'index.html');
  app.get('/', (_req, res) => {
    res.sendFile(rootIndex);
  });

  app.use((err, _req, res, _next) => {
    console.error('[api-error]', err && err.message ? err.message : err);
    const status = Number(err && err.status) || 500;
    res.status(status).json({ status: 'error', message: status < 500 ? err.message : 'Internal server error.' });
  });

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Lite Games Unified Platform running on port ${port}`);
  });

  return { app, httpServer, io };
}

if (require.main === module) {
  startPlatformServer(Number(process.env.PORT || 3000));
}

module.exports = { startPlatformServer };
