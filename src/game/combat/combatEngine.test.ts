import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatEngine } from './combatEngine';
import { COMBAT_CONFIG } from '../../types/combat';

test('CombatEngine initializes fighters with 100 HP, 100 Stamina and correct positions', () => {
  const engine = new CombatEngine('Player', 'Opponent');
  const player = engine.getPlayer();
  const opponent = engine.getOpponent();

  assert.equal(player.hp, 100);
  assert.equal(player.stamina, 100);
  assert.equal(opponent.hp, 100);
  assert.equal(opponent.stamina, 100);
  assert.equal(player.position.x < opponent.position.x, true);
  assert.equal(player.facingDirection, 1);
  assert.equal(opponent.facingDirection, -1);
});

test('Handling attack input initiates WINDUP and drains stamina', () => {
  const engine = new CombatEngine();
  const player = engine.getPlayer();

  const success = engine.handleInput(player.id, {
    action: 'LEFT_PUNCH',
    confidence: 0.95,
    source: 'keyboard',
    timestamp: 1000,
  });

  assert.equal(success, true);
  assert.equal(player.currentAction, 'LEFT_PUNCH');
  assert.equal(player.actionPhase, 'WINDUP');
  assert.equal(player.stamina, 100 - COMBAT_CONFIG.ATTACKS.LEFT_PUNCH.staminaCost);
});

test('Attack transitions from WINDUP to ACTIVE to RECOVERY to IDLE across ticks', () => {
  const engine = new CombatEngine();
  const player = engine.getPlayer();

  engine.handleInput(player.id, {
    action: 'LEFT_PUNCH',
    confidence: 0.95,
    source: 'keyboard',
    timestamp: 1000,
  });

  // Startup duration is 0.08s
  engine.update(0.04);
  assert.equal(player.actionPhase, 'WINDUP');

  // Advance past startup
  engine.update(0.05);
  assert.equal(player.actionPhase, 'ACTIVE');

  // Advance past active (0.12s)
  engine.update(0.13);
  assert.equal(player.actionPhase, 'RECOVERY');

  // Advance past recovery (0.14s)
  engine.update(0.15);
  assert.equal(player.actionPhase, 'IDLE');
});

test('Hit detection reduces defender HP and records hit event when in range', () => {
  const engine = new CombatEngine();
  const player = engine.getPlayer();
  const opponent = engine.getOpponent();

  // Move opponent into punch range (range is ~1.85)
  player.position.x = 0;
  opponent.position.x = 1.2;

  engine.handleInput(player.id, {
    action: 'LEFT_PUNCH',
    confidence: 0.95,
    source: 'keyboard',
    timestamp: 1000,
  });

  // Startup duration is 0.08s. Update in small steps until hit registers
  let hitRegistered = false;
  let finalHitEvent = null;
  for (let i = 0; i < 10; i++) {
    const res = engine.update(0.02);
    if (res.hitEvents.length > 0) {
      hitRegistered = true;
      finalHitEvent = res.hitEvents[0];
      break;
    }
  }

  assert.equal(hitRegistered, true);
  assert.equal(opponent.hp < 100, true);
  assert.equal(finalHitEvent?.damage, COMBAT_CONFIG.ATTACKS.LEFT_PUNCH.damage);
  assert.equal(player.comboCount, 1);
});

test('Blocking reduces incoming attack damage significantly (chip damage)', () => {
  const engine = new CombatEngine();
  const player = engine.getPlayer();
  const opponent = engine.getOpponent();

  player.position.x = 0;
  opponent.position.x = 1.2;

  // Opponent blocks
  engine.handleInput(opponent.id, {
    action: 'BLOCK',
    confidence: 0.9,
    source: 'keyboard',
    timestamp: 1000,
  });

  // Player attacks
  engine.handleInput(player.id, {
    action: 'RIGHT_PUNCH',
    confidence: 0.95,
    source: 'keyboard',
    timestamp: 1000,
  });

  let hitRegistered = false;
  let finalHitEvent = null;
  for (let i = 0; i < 15; i++) {
    const res = engine.update(0.02);
    if (res.hitEvents.length > 0) {
      hitRegistered = true;
      finalHitEvent = res.hitEvents[0];
      break;
    }
  }

  assert.equal(hitRegistered, true);
  assert.equal(finalHitEvent?.wasBlocked, true);
  // Full damage is 12, blocked multiplier is 0.2 -> ~2 damage
  assert.equal((finalHitEvent?.damage ?? 10) < 5, true);
  assert.equal(opponent.hp >= 95, true);
});

test('KO triggers victory state when HP reaches 0', () => {
  const engine = new CombatEngine();
  const opponent = engine.getOpponent();

  opponent.hp = 5;
  const player = engine.getPlayer();
  player.position.x = 0;
  opponent.position.x = 1.0;

  engine.handleInput(player.id, {
    action: 'RIGHT_PUNCH', // deals 12 damage
    confidence: 0.95,
    source: 'keyboard',
    timestamp: 1000,
  });

  engine.update(0.14);
  const result = engine.update(0.02);

  assert.equal(opponent.isAlive, false);
  assert.equal(result.isRoundOver, true);
  assert.equal(result.winnerId, player.id);
});

test('Match timer counts down and declares winner on timeout', () => {
  const engine = new CombatEngine();
  const player = engine.getPlayer();
  const opponent = engine.getOpponent();

  // Give player an HP advantage
  opponent.hp = 80;

  // Fast forward past 60 seconds
  for (let i = 0; i < 65; i++) {
    engine.update(1.0);
  }

  assert.equal(engine.isFinished(), true);
  assert.equal(engine.getWinner(), player.id);
});
