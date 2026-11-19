'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const firestoreWallet = require('./firestore-wallet');
const { AviatorBalanceManager } = require('./balance');
const { AviatorGameRoom } = require('./gameroom');
const { AviatorRound } = require('./round');

test('new Aviator accounts start with zero ETB', () => {
  const balances = new AviatorBalanceManager();
  assert.equal(balances.getBalance('aviator-safety-test-user'), 0);
});

test('legacy Aviator top-up and rain-claim methods are unavailable', () => {
  const balances = new AviatorBalanceManager();
  assert.equal(typeof balances.topUp, 'undefined');
  assert.equal(typeof balances.claimRain, 'undefined');
});

test('Aviator rejects direct bet, cancel and cash-out calls while Firestore migration is incomplete', () => {
  const room = new AviatorGameRoom();
  assert.equal(room.placeBet({ playerId: 'test-user', amount: 10 }).ok, false);
  assert.equal(room.cancelBet({ playerId: 'test-user' }).ok, false);
  assert.equal(room.cashOut({ playerId: 'test-user' }).ok, false);
});

test('Aviator room feed contains no simulated players or fabricated player counts', () => {
  const round = new AviatorRound(1);
  const feed = round.getFeedRows();
  assert.deepEqual(feed.rows, []);
  assert.equal(feed.totalDisplayBets, 0);
  assert.equal(feed.activeBetsLeft, 0);
});

test('unknown round fairness proof is not fabricated', () => {
  const room = new AviatorGameRoom();
  assert.equal(room.getFairnessProof(987654321), null);
});

test('Firestore wallet exposes transactional bet, refund, cash-out and settlement operations', () => {
  for (const name of ['createRound', 'startRound', 'crashRound', 'placeBet', 'cancelBet', 'cashOut', 'settleLoss', 'getRoundHistory', 'getRoundProof']) {
    assert.equal(typeof firestoreWallet[name], 'function', name + ' must be implemented');
  }
});

test('Aviator socket identity comes only from verified Firebase socket data', () => {
  const source = fs.readFileSync(path.join(__dirname, 'gameroom.js'), 'utf8');
  assert.match(source, /socket\.data\.uid/);
  assert.doesNotMatch(source, /socket\.handshake\.auth\?\.playerId/);
  assert.doesNotMatch(source, /payload\.playerId\s*\|\|/);
});

test('Aviator UI contains no demo top-up or fabricated player counts', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'games', 'aviator.html'), 'utf8');
  assert.doesNotMatch(html, /addDemoFunds/);
  assert.doesNotMatch(html, /totalDisplayBets:\s*435/);
  assert.doesNotMatch(html, />1080</);
  assert.doesNotMatch(html, />435</);
});
