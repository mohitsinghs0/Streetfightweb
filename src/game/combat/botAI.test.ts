import test from 'node:test';
import assert from 'node:assert/strict';
import { BotAI } from './botAI';
import { FighterState } from '../../types/combat';

function createDummyFighter(id: string, isPlayer: boolean, posX: number): FighterState {
  return {
    id,
    name: id,
    isPlayer,
    hp: 100,
    maxHp: 100,
    stamina: 100,
    maxStamina: 100,
    position: { x: posX, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    facingDirection: isPlayer ? 1 : -1,
    currentAction: 'IDLE',
    actionPhase: 'IDLE',
    phaseTimer: 0,
    attackCooldown: 0,
    stunTimer: 0,
    invulnerabilityTimer: 0,
    isBlocking: false,
    isGrounded: true,
    isAlive: true,
    comboCount: 0,
    comboTimer: 0,
    totalHitsLanded: 0,
    totalDamageDealt: 0,
  };
}

test('BotAI initializes with specified difficulty and config', () => {
  const easyBot = new BotAI('EASY');
  assert.equal(easyBot.getDifficulty(), 'EASY');
  assert.equal(easyBot.getConfig().reactionTime, 0.6);

  const hardBot = new BotAI('HARD');
  assert.equal(hardBot.getDifficulty(), 'HARD');
  assert.equal(hardBot.getConfig().reactionTime, 0.15);
});

test('BotAI approaches player when far away', () => {
  const bot = new BotAI('MEDIUM');
  bot.reset();
  const botFighter = createDummyFighter('bot', false, 4.0);
  const playerFighter = createDummyFighter('player', true, -2.0);

  // Distance is 6.0 (> 2.2), bot should decide to move forward
  // Advance past initial cooldown
  const input = bot.update(1.5, botFighter, playerFighter);
  assert.equal(input !== null, true);
  assert.equal(input?.action, 'MOVE_FORWARD');
});

test('BotAI reacts defensively to player attack windup', () => {
  const hardBot = new BotAI('HARD');
  hardBot.reset();
  const botFighter = createDummyFighter('bot', false, 1.5);
  const playerFighter = createDummyFighter('player', true, 0);

  // Set player in WINDUP
  playerFighter.actionPhase = 'WINDUP';
  playerFighter.currentAction = 'RIGHT_PUNCH';

  // Hard bot has 75% block and 55% dodge probability
  // Running update over multiple attempts should trigger a defensive move
  let defensiveTriggered = false;
  for (let i = 0; i < 10; i++) {
    hardBot.reset();
    const input = hardBot.update(0.1, botFighter, playerFighter);
    if (input && (input.action === 'BLOCK' || input.action.includes('DODGE'))) {
      defensiveTriggered = true;
      break;
    }
  }

  assert.equal(defensiveTriggered, true);
});

test('BotAI switches difficulty dynamically', () => {
  const bot = new BotAI('EASY');
  assert.equal(bot.getDifficulty(), 'EASY');

  bot.setDifficulty('HARD');
  assert.equal(bot.getDifficulty(), 'HARD');
  assert.equal(bot.getConfig().comboProbability, 0.7);
});
