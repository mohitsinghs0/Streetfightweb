/**
 * Modular Bot AI with Configurable Difficulty (Easy / Medium / Hard)
 */

import {
  ActionType,
  BOT_DIFFICULTIES,
  BotConfig,
  BotDifficulty,
  FighterState,
  GameInput,
} from '../../types/combat';

export class BotAI {
  private config: BotConfig;
  private actionCooldown: number = 0;
  private comboChain: ActionType[] = [];
  private comboStep: number = 0;

  constructor(difficulty: BotDifficulty = 'MEDIUM') {
    this.config = BOT_DIFFICULTIES[difficulty];
  }

  public setDifficulty(difficulty: BotDifficulty): void {
    this.config = BOT_DIFFICULTIES[difficulty];
    this.reset();
  }

  public getDifficulty(): BotDifficulty {
    return this.config.difficulty;
  }

  public getConfig(): BotConfig {
    return this.config;
  }

  public reset(initialCooldown: number = 0): void {
    this.actionCooldown = initialCooldown;
    this.comboChain = [];
    this.comboStep = 0;
  }

  /**
   * Evaluates combat state and decides bot action
   */
  public update(dt: number, botState: FighterState, playerState: FighterState): GameInput | null {
    if (!botState.isAlive || !playerState.isAlive) return null;
    if (botState.stunTimer > 0) return null;

    this.actionCooldown -= dt;

    // React defensively to player attack windup
    const playerAttacking = playerState.actionPhase === 'WINDUP';
    if (playerAttacking && this.actionCooldown <= 0.3) {
      if (Math.random() < this.config.blockProbability) {
        this.actionCooldown = this.config.reactionTime + 0.3;
        return {
          action: 'BLOCK',
          confidence: 0.95,
          source: 'keyboard',
          timestamp: Date.now(),
        };
      } else if (Math.random() < this.config.dodgeProbability) {
        this.actionCooldown = this.config.reactionTime + 0.4;
        const dodgeDir = Math.random() < 0.5 ? 'DODGE_LEFT' : 'DODGE_RIGHT';
        return {
          action: dodgeDir,
          confidence: 0.9,
          source: 'keyboard',
          timestamp: Date.now(),
        };
      }
    }

    if (this.actionCooldown > 0) return null;

    // Reset action cooldown based on difficulty
    const nextCooldown =
      this.config.actionCooldownMin +
      Math.random() * (this.config.actionCooldownMax - this.config.actionCooldownMin);
    this.actionCooldown = nextCooldown;

    // Measure distance between fighters
    const dist = Math.abs(botState.position.x - playerState.position.x);

    // If far, approach player
    if (dist > 2.2) {
      return {
        action: 'MOVE_FORWARD',
        confidence: 0.9,
        source: 'keyboard',
        timestamp: Date.now(),
      };
    }

    // In striking distance
    if (this.comboChain.length > 0 && this.comboStep < this.comboChain.length) {
      const act = this.comboChain[this.comboStep++];
      if (this.comboStep >= this.comboChain.length) {
        this.comboChain = [];
        this.comboStep = 0;
      }
      return {
        action: act,
        confidence: 0.95,
        source: 'keyboard',
        timestamp: Date.now(),
      };
    }

    // Roll for combo on Medium / Hard
    if (Math.random() < this.config.comboProbability) {
      if (this.config.difficulty === 'HARD') {
        this.comboChain = ['LEFT_PUNCH', 'RIGHT_PUNCH', 'LEFT_HOOK'];
      } else {
        this.comboChain = ['LEFT_PUNCH', 'RIGHT_PUNCH'];
      }
      this.comboStep = 1;
      return {
        action: this.comboChain[0],
        confidence: 0.95,
        source: 'keyboard',
        timestamp: Date.now(),
      };
    }

    // Single strikes
    const roll = Math.random();
    let action: ActionType = 'LEFT_PUNCH';

    if (roll < 0.4) {
      action = 'LEFT_PUNCH';
    } else if (roll < 0.7) {
      action = 'RIGHT_PUNCH';
    } else if (roll < 0.88) {
      action = 'KICK';
    } else {
      action = 'BLOCK';
    }

    return {
      action,
      confidence: 0.9,
      source: 'keyboard',
      timestamp: Date.now(),
    };
  }
}
