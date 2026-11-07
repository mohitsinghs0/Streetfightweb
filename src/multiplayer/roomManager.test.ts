import test from 'node:test';
import assert from 'node:assert/strict';
import { multiplayerRoomManager, normalizeRoomCode } from './roomManager';

test('MultiplayerRoomManager creates valid shareable 6-digit room code', () => {
  const code = multiplayerRoomManager.createPrivateRoom();
  assert.equal(code.startsWith('KNT-'), true);
  assert.equal(code.length, 8); // 'KNT-XXXX'
  assert.equal(multiplayerRoomManager.getCurrentRoomCode(), code);
  assert.equal(multiplayerRoomManager.getIsHost(), true);
  assert.equal(multiplayerRoomManager.getConnectionState(), 'WAITING_FOR_PEER');
  multiplayerRoomManager.leaveRoom();
});

test('MultiplayerRoomManager enters waiting queue without immediately generating fake matches', () => {
  multiplayerRoomManager.enterQuickMatchQueue();
  assert.equal(multiplayerRoomManager.getCurrentRoomCode(), 'GLOBAL_QUICK_QUEUE');
  assert.equal(multiplayerRoomManager.getConnectionState(), 'WAITING_FOR_PEER');
  assert.equal(multiplayerRoomManager.getRemotePeer(), null); // NO fake auto-bot!
  multiplayerRoomManager.leaveRoom();
});

test('normalizeRoomCode formats 4 digits and variations into standard KNT-XXXX', () => {
  assert.equal(normalizeRoomCode('8492'), 'KNT-8492');
  assert.equal(normalizeRoomCode('knt8492'), 'KNT-8492');
  assert.equal(normalizeRoomCode('knt-8492'), 'KNT-8492');
  assert.equal(normalizeRoomCode(' KNT - 8492 '), 'KNT-8492');
  assert.equal(normalizeRoomCode('KNT-1234'), 'KNT-1234');
});

test('MultiplayerRoomManager joinPrivateRoom normalizes input code', () => {
  const success = multiplayerRoomManager.joinPrivateRoom('9988');
  assert.equal(success, true);
  assert.equal(multiplayerRoomManager.getCurrentRoomCode(), 'KNT-9988');
  assert.equal(multiplayerRoomManager.getIsHost(), false);
  assert.equal(multiplayerRoomManager.getConnectionState(), 'WAITING_FOR_HOST');
  multiplayerRoomManager.leaveRoom();
});
