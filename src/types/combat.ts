/**
 * Combat & Fighter Engine Data Types
 */

export type ActionType =
  | 'IDLE'
  | 'MOVE_FORWARD'
  | 'MOVE_BACKWARD'
  | 'DODGE_LEFT'
  | 'DODGE_RIGHT'
  | 'CROUCH'
  | 'BLOCK'
  | 'LEFT_PUNCH'
  | 'RIGHT_PUNCH'
  | 'LEFT_HOOK'
  | 'RIGHT_HOOK'
  | 'KICK'
  | 'STUN'
  | 'KO';

export type ActionPhase = 'IDLE' | 'WINDUP' | 'ACTIVE' | 'RECOVERY' | 'BLOCK' | 'STUN' | 'DODGE' | 'KO';

export interface AttackConfig {
  name: string;
  damage: number;
  staminaCost: number;
  startupDuration: number; // in seconds
  activeDuration: number;  // in seconds
  recoveryDuration: number; // in seconds
  range: number;           // hit reach in arena units
  knockback: number;
  blockDamageMultiplier: number;
}

export const COMBAT_CONFIG = {
  MAX_HP: 100,
  MAX_STAMINA: 100,
  STAMINA_REGEN_RATE: 18, // per second when not performing heavy actions
  BLOCK_STAMINA_DRAIN: 12, // per second while holding block
  DODGE_STAMINA_COST: 15,
  MOVE_SPEED: 3.2,
  DODGE_SPEED: 7.5,
  DODGE_DURATION: 0.28,
  STUN_DURATION_ON_HIT: 0.32,
  HITSTOP_HEAVY: 0.06,
  ROUND_TIME: 60,
  ATTACKS: {
    LEFT_PUNCH: {
      name: 'Left Jab',
      damage: 7,
      staminaCost: 8,
      startupDuration: 0.08,
      activeDuration: 0.12,
      recoveryDuration: 0.14,
      range: 1.85,
      knockback: 0.4,
      blockDamageMultiplier: 0.15,
    },
    RIGHT_PUNCH: {
      name: 'Right Cross',
      damage: 12,
      staminaCost: 14,
      startupDuration: 0.12,
      activeDuration: 0.14,
      recoveryDuration: 0.18,
      range: 1.95,
      knockback: 0.7,
      blockDamageMultiplier: 0.2,
    },
    LEFT_HOOK: {
      name: 'Left Hook',
      damage: 15,
      staminaCost: 18,
      startupDuration: 0.15,
      activeDuration: 0.16,
      recoveryDuration: 0.22,
      range: 1.75,
      knockback: 0.9,
      blockDamageMultiplier: 0.25,
    },
    RIGHT_HOOK: {
      name: 'Right Hook',
      damage: 16,
      staminaCost: 20,
      startupDuration: 0.16,
      activeDuration: 0.16,
      recoveryDuration: 0.24,
      range: 1.8,
      knockback: 1.0,
      blockDamageMultiplier: 0.25,
    },
    KICK: {
      name: 'Front Kick',
      damage: 18,
      staminaCost: 24,
      startupDuration: 0.2,
      activeDuration: 0.18,
      recoveryDuration: 0.28,
      range: 2.3,
      knockback: 1.4,
      blockDamageMultiplier: 0.3,
    },
  } as Record<string, AttackConfig>,
};

export interface FighterState {
  id: string;
  name: string;
  isPlayer: boolean;
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  facingDirection: 1 | -1; // 1 = facing right (+x), -1 = facing left (-x)
  currentAction: ActionType;
  actionPhase: ActionPhase;
  phaseTimer: number; // time spent in current phase
  attackCooldown: number;
  stunTimer: number;
  invulnerabilityTimer: number;
  isBlocking: boolean;
  isGrounded: boolean;
  isAlive: boolean;
  comboCount: number;
  comboTimer: number;
  totalHitsLanded: number;
  totalDamageDealt: number;
}

export interface HitEvent {
  id: string;
  attackerId: string;
  defenderId: string;
  action: ActionType;
  damage: number;
  wasBlocked: boolean;
  wasDodged: boolean;
  position: { x: number; y: number; z: number };
  timestamp: number;
}

export type BotDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface BotConfig {
  name: string;
  difficulty: BotDifficulty;
  reactionTime: number; // in seconds
  actionCooldownMin: number;
  actionCooldownMax: number;
  blockProbability: number;
  dodgeProbability: number;
  comboProbability: number;
  moveSpeedMultiplier: number;
}

export const BOT_DIFFICULTIES: Record<BotDifficulty, BotConfig> = {
  EASY: {
    name: 'SPARRING BOT (EASY)',
    difficulty: 'EASY',
    reactionTime: 0.6,
    actionCooldownMin: 1.6,
    actionCooldownMax: 2.4,
    blockProbability: 0.15,
    dodgeProbability: 0.1,
    comboProbability: 0.05,
    moveSpeedMultiplier: 0.75,
  },
  MEDIUM: {
    name: 'CYBER GLADIATOR (MEDIUM)',
    difficulty: 'MEDIUM',
    reactionTime: 0.35,
    actionCooldownMin: 0.9,
    actionCooldownMax: 1.4,
    blockProbability: 0.45,
    dodgeProbability: 0.3,
    comboProbability: 0.35,
    moveSpeedMultiplier: 1.0,
  },
  HARD: {
    name: 'TITAN PRIME (HARD)',
    difficulty: 'HARD',
    reactionTime: 0.15,
    actionCooldownMin: 0.45,
    actionCooldownMax: 0.8,
    blockProbability: 0.75,
    dodgeProbability: 0.55,
    comboProbability: 0.7,
    moveSpeedMultiplier: 1.25,
  },
};

export type MatchmakingState = 'IDLE' | 'SEARCHING' | 'FOUND' | 'READY' | 'IN_MATCH';

export interface MultiplayerPlayer {
  id: string;
  name: string;
  rank: string;
  pingMs: number;
  isReady: boolean;
}

export interface GameInput {
  action: ActionType;
  direction?: { x: number; y: number };
  confidence: number;
  source: 'camera' | 'keyboard';
  timestamp: number;
}
