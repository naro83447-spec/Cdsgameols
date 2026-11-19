const express = require('express');
const { sharedWallet } = require('./wallet');

// This interim safety layer deliberately blocks money creation until the
// Firestore + verified Telegram identity + admin approval migration is enabled.
// Do not re-enable direct credits from browser requests.
function attachWalletRoutes(app) {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'LITE_GAMES_WALLET_SAFETY_MODE',
      storage: 'in-memory (migration pending)',
      fundingEnabled: false,
      playersCount: sharedWallet.players.size
    });
  });

  router.get('/state', (req, res) => {
    const playerId = String(req.query.playerId || req.get('X-Player-Id') || 'lg_guest');
    const displayName = String(req.query.displayName || '');
    res.json({ status: 'success', ...sharedWallet.getPlayerState(playerId, displayName) });
  });

  router.post('/profile', (req, res) => {
    const playerId = String(req.body?.playerId || req.get('X-Player-Id') || 'lg_guest');
    const displayName = String(req.body?.displayName || '').trim();
    res.json({ status: 'success', ...sharedWallet.getPlayerState(playerId, displayName) });
  });

  router.post('/deposit', (_req, res) => res.status(503).json({
    status: 'unavailable',
    code: 'FIRESTORE_ADMIN_APPROVAL_REQUIRED',
    message: 'Deposit submissions are temporarily disabled until Firestore persistence, verified player identity, and admin approval are enabled. No wallet credit was made.'
  }));

  router.post('/reward', (_req, res) => res.status(503).json({
    status: 'unavailable',
    code: 'DEMO_REWARDS_DISABLED',
    message: 'Demo wallet rewards are disabled. No wallet credit was made.'
  }));

  router.get('/winners', (_req, res) => res.json({
    status: 'success',
    topWinners: sharedWallet.getTopWinners(16),
    leaderboard: sharedWallet.getLeaderboard(20)
  }));

  app.use('/api/wallet', router);
  return router;
}

module.exports = { attachWalletRoutes };
