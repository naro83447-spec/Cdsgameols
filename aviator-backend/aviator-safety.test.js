'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
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
