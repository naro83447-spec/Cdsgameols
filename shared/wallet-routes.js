const express = require('express');
const { sharedWallet } = require('./wallet');

function attachWalletRoutes(app) {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'LITE_GAMES_UNIFIED_WALLET',
      playersCount: sharedWallet.players.size,
      winnersCount: sharedWallet.topWinners.length
    });
  });

  router.get('/state', (req, res) => {
    const playerId = String(req.query.playerId || req.get('X-Player-Id') || 'lg_guest');
    const displayName = String(req.query.displayName || '');
    res.json({
      status: 'success',
      ...sharedWallet.getPlayerState(playerId, displayName)
    });
  });

  router.post('/profile', (req, res) => {
    const playerId = String(req.body?.playerId || req.get('X-Player-Id') || 'lg_guest');
    const displayName = String(req.body?.displayName || '').trim();
    const state = sharedWallet.getPlayerState(playerId, displayName);
    res.json({ status: 'success', ...state });
  });

  router.post('/deposit', (req, res) => {
    const playerId = String(req.body?.playerId || req.get('X-Player-Id') || 'lg_guest');
    const amount = Number(req.body?.amount || 500);
    const method = String(req.body?.method || 'Telebirr');
    if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
      return res.status(400).json({
        status: 'error',
        message: 'የክፍያ መጠን ከ 1 እስከ 100,000 ETB መሆን አለበት'
      });
    }
    const result = sharedWallet.deposit(playerId, amount, method);
    res.json({ status: 'success', ...result });
  });

  router.post('/reward', (req, res) => {
    const playerId = String(req.body?.playerId || req.get('X-Player-Id') || 'lg_guest');
    const result = sharedWallet.claimReward(playerId, 100);
    if (!result.ok) {
      return res.status(400).json({ status: 'error', message: result.error, ...result });
    }
    res.json({ status: 'success', ...result });
  });

  router.get('/winners', (_req, res) => {
    res.json({
      status: 'success',
      topWinners: sharedWallet.getTopWinners(16),
      leaderboard: sharedWallet.getLeaderboard(20)
    });
  });

  app.use('/api/wallet', router);
  return router;
}

module.exports = { attachWalletRoutes };
