'use strict';

const express = require('express');
const { requireFirebaseUser, requireAdmin } = require('./firebase-admin');
const wallet = require('./firestore-wallet');

function attachSecureWalletRoutes(app) {
  const router = express.Router();
  router.use(requireFirebaseUser);

  router.get('/state', async (req, res, next) => {
    try {
      const [account, transactions] = await Promise.all([
        wallet.getWallet(req.user.uid), wallet.getTransactions(req.user.uid)
      ]);
      res.json({ status: 'success', ...account, transactions });
    } catch (error) { next(error); }
  });

  router.post('/deposit-requests', async (req, res, next) => {
    try {
      const result = await wallet.createDepositRequest(req.user.uid, req.body || {});
      res.status(201).json({ status: 'success', ...result });
    } catch (error) { next(error); }
  });

  router.get('/admin/deposit-requests', requireAdmin, async (_req, res, next) => {
    try {
      res.json({ status: 'success', requests: await wallet.listPendingDeposits() });
    } catch (error) { next(error); }
  });

  router.post('/admin/deposit-requests/:uid/:requestId/review', requireAdmin, async (req, res, next) => {
    try {
      const decision = String(req.body && req.body.decision || '').toUpperCase();
      if (!['APPROVE', 'REJECT'].includes(decision)) {
        return res.status(400).json({ status: 'error', message: 'Decision must be APPROVE or REJECT.' });
      }
      const result = await wallet.reviewDeposit(
        req.params.uid, req.params.requestId, decision, req.user.uid, req.body.note || ''
      );
      res.json({ status: 'success', ...result });
    } catch (error) { next(error); }
  });

  app.use('/api/wallet', router);
  return router;
}
module.exports = { attachSecureWalletRoutes };
