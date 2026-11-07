/**
 * Deterministic Combat & Physics Simulation Engine
 */

import {
  ActionPhase,
  ActionType,
  AttackConfig,
  COMBAT_CONFIG,
  FighterState,
  GameInput,
  HitEvent,
} from '../../types/combat';

export interface CombatSimulationResult {
  player: FighterState;
  opponent: FighterState;
  hitEvents: HitEvent[];
  roundTimeRemaining: number;
  isRoundOver: boolean;
  winnerId: string | null;
}

export class CombatEngine {
  private player: FighterState;
  private opponent: FighterState;
  private roundTimeRemaining: number = COMBAT_CONFIG.ROUND_TIME;
  private isRoundOver: boolean = false;
  private winnerId: string | null = null;
  private nextEventId: number = 1;

  constructor(
    playerName: string = 'KINETIC 01',
    opponentName: string = 'TRAINING DUMMY'
  ) {
    this.player = this.createFighter('p1', playerName, true, -2.5, 1);
    this.opponent = this.createFighter('p2', opponentName, false, 2.5, -1);
  }

  private createFighter(
    id: string,
    name: string,
    isPlayer: boolean,
    startX: number,
    facing: 1 | -1
  ): FighterState {
    return {
      id,
      name,
      isPlayer,
      hp: COMBAT_CONFIG.MAX_HP,
      maxHp: COMBAT_CONFIG.MAX_HP,
      stamina: COMBAT_CONFIG.MAX_STAMINA,
      maxStamina: COMBAT_CONFIG.MAX_STAMINA,
      position: { x: startX, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      facingDirection: facing,
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

  public getPlayer(): FighterState {
    return this.player;
  }

  public getOpponent(): FighterState {
    return this.opponent;
  }

  public getRoundTime(): number {
    return this.roundTimeRemaining;
  }

  public isFinished(): boolean {
    return this.isRoundOver;
  }

  public getWinner(): string | null {
    return this.winnerId;
  }

  /**
   * Applies an intentional input action to a fighter
   */
  public handleInput(fighterId: string, input: GameInput): boolean {
    const fighter = fighterId === this.player.id ? this.player : this.opponent;
    if (!fighter.isAlive || this.isRoundOver) return false;

    // Cannot act while stunned or in active/windup attack phases
    if (fighter.stunTimer > 0) return false;
    if (fighter.actionPhase === 'WINDUP' || fighter.actionPhase === 'ACTIVE') return false;

    const action = input.action;

    // Movement
    if (action === 'MOVE_FORWARD') {
      fighter.velocity.x = fighter.facingDirection * COMBAT_CONFIG.MOVE_SPEED;
      fighter.currentAction = 'MOVE_FORWARD';
      return true;
    }

    if (action === 'MOVE_BACKWARD') {
      fighter.velocity.x = -fighter.facingDirection * (COMBAT_CONFIG.MOVE_SPEED * 0.85);
      fighter.currentAction = 'MOVE_BACKWARD';
      return true;
    }

    // Dodge
    if (action === 'DODGE_LEFT' || action === 'DODGE_RIGHT') {
      if (fighter.stamina < COMBAT_CONFIG.DODGE_STAMINA_COST) return false;
      const dodgeDir = action === 'DODGE_RIGHT' ? 1 : -1;
      fighter.stamina -= COMBAT_CONFIG.DODGE_STAMINA_COST;
      fighter.velocity.x = dodgeDir * COMBAT_CONFIG.DODGE_SPEED;
      fighter.currentAction = action;
      fighter.actionPhase = 'DODGE';
      fighter.phaseTimer = COMBAT_CONFIG.DODGE_DURATION;
      fighter.invulnerabilityTimer = COMBAT_CONFIG.DODGE_DURATION * 0.8;
      return true;
    }

    // Block
    if (action === 'BLOCK') {
      fighter.isBlocking = true;
      fighter.currentAction = 'BLOCK';
      fighter.actionPhase = 'BLOCK';
      return true;
    }

    // Attacks (Strikes)
    const attackCfg: AttackConfig | undefined = COMBAT_CONFIG.ATTACKS[action];
    if (attackCfg) {
      if (fighter.stamina < attackCfg.staminaCost) return false;
      if (fighter.attackCooldown > 0) return false;

      fighter.stamina -= attackCfg.staminaCost;
      fighter.currentAction = action;
      fighter.actionPhase = 'WINDUP';
      fighter.phaseTimer = attackCfg.startupDuration;
      fighter.isBlocking = false;
      return true;
    }

    // Reset block if IDLE or unhandled
    if (action === 'IDLE' && fighter.isBlocking) {
      fighter.isBlocking = false;
      fighter.currentAction = 'IDLE';
      fighter.actionPhase = 'IDLE';
    }

    return true;
  }

  /**
   * Main deterministic simulation tick (fixed timestep sub-stepping)
   */
  public update(dt: number): CombatSimulationResult {
    // Fixed timestep of 1/60s (approx 0.01667s)
    const fixedStep = 1 / 60;
    // Cap total simulation time per call to prevent spiral of death (max 1.5s)
    const totalSimTime = Math.min(dt, 1.5);
    const hitEvents: HitEvent[] = [];

    let elapsed = 0;
    while (elapsed < totalSimTime) {
      const step = Math.min(fixedStep, totalSimTime - elapsed);
      elapsed += step;

      if (!this.isRoundOver) {
        this.roundTimeRemaining = Math.max(0, this.roundTimeRemaining - step);
        if (this.roundTimeRemaining <= 0) {
          this.isRoundOver = true;
          this.winnerId =
            this.player.hp > this.opponent.hp
              ? this.player.id
              : this.opponent.hp > this.player.hp
              ? this.opponent.id
              : 'DRAW';
          break;
        }
      }

      // Update both fighters
      this.updateFighter(this.player, step);
      this.updateFighter(this.opponent, step);

      // Keep fighters facing each other
      if (this.player.position.x < this.opponent.position.x) {
        this.player.facingDirection = 1;
        this.opponent.facingDirection = -1;
      } else {
        this.player.facingDirection = -1;
        this.opponent.facingDirection = 1;
      }

      // Process Hit Detection
      if (!this.isRoundOver) {
        this.checkHit(this.player, this.opponent, hitEvents);
        this.checkHit(this.opponent, this.player, hitEvents);
      }

      // Check KO
      if (this.player.hp <= 0 && this.player.isAlive) {
        this.player.isAlive = false;
        this.player.hp = 0;
        this.player.currentAction = 'KO';
        this.player.actionPhase = 'KO';
        this.isRoundOver = true;
        this.winnerId = this.opponent.id;
        break;
      }

      if (this.opponent.hp <= 0 && this.opponent.isAlive) {
        this.opponent.isAlive = false;
        this.opponent.hp = 0;
        this.opponent.currentAction = 'KO';
        this.opponent.actionPhase = 'KO';
        this.isRoundOver = true;
        this.winnerId = this.player.id;
        break;
      }
    }

    return {
      player: this.player,
      opponent: this.opponent,
      hitEvents,
      roundTimeRemaining: this.roundTimeRemaining,
      isRoundOver: this.isRoundOver,
      winnerId: this.winnerId,
    };
  }

  private updateFighter(f: FighterState, dt: number): void {
    if (!f.isAlive) {
      f.velocity.x *= 0.85;
      return;
    }

    // Apply friction and integration
    f.position.x += f.velocity.x * dt;
    f.velocity.x *= 0.82; // linear damping

    // Arena boundary limits (-6 to +6 units)
    f.position.x = Math.max(-5.5, Math.min(5.5, f.position.x));

    // Timers
    if (f.stunTimer > 0) {
      f.stunTimer = Math.max(0, f.stunTimer - dt);
      if (f.stunTimer === 0 && f.actionPhase === 'STUN') {
        f.actionPhase = 'IDLE';
        f.currentAction = 'IDLE';
      }
    }

    if (f.invulnerabilityTimer > 0) {
      f.invulnerabilityTimer = Math.max(0, f.invulnerabilityTimer - dt);
    }

    if (f.attackCooldown > 0) {
      f.attackCooldown = Math.max(0, f.attackCooldown - dt);
    }

    if (f.comboTimer > 0) {
      f.comboTimer = Math.max(0, f.comboTimer - dt);
      if (f.comboTimer === 0) {
        f.comboCount = 0;
      }
    }

    // Stamina Regeneration / Drain
    if (f.isBlocking) {
      f.stamina = Math.max(0, f.stamina - COMBAT_CONFIG.BLOCK_STAMINA_DRAIN * dt);
      if (f.stamina === 0) {
        // Block broken
        f.isBlocking = false;
        f.stunTimer = 0.4;
        f.actionPhase = 'STUN';
      }
    } else if (f.actionPhase === 'IDLE' || f.currentAction === 'MOVE_FORWARD' || f.currentAction === 'MOVE_BACKWARD') {
      f.stamina = Math.min(f.maxStamina, f.stamina + COMBAT_CONFIG.STAMINA_REGEN_RATE * dt);
    }

    // Attack State Machine transitions: WINDUP -> ACTIVE -> RECOVERY -> IDLE
    const attackCfg: AttackConfig | undefined = COMBAT_CONFIG.ATTACKS[f.currentAction];
    if (attackCfg) {
      f.phaseTimer -= dt;

      if (f.actionPhase === 'WINDUP' && f.phaseTimer <= 0) {
        f.actionPhase = 'ACTIVE';
        f.phaseTimer = attackCfg.activeDuration;
      } else if (f.actionPhase === 'ACTIVE' && f.phaseTimer <= 0) {
        f.actionPhase = 'RECOVERY';
        f.phaseTimer = attackCfg.recoveryDuration;
      } else if (f.actionPhase === 'RECOVERY' && f.phaseTimer <= 0) {
        f.actionPhase = 'IDLE';
        f.currentAction = 'IDLE';
        f.attackCooldown = 0.08;
      }
    } else if (f.actionPhase === 'DODGE') {
      f.phaseTimer -= dt;
      if (f.phaseTimer <= 0) {
        f.actionPhase = 'IDLE';
        f.currentAction = 'IDLE';
      }
    }
  }

  private checkHit(attacker: FighterState, defender: FighterState, events: HitEvent[]): void {
    if (attacker.actionPhase !== 'ACTIVE') return;
    const attackCfg: AttackConfig | undefined = COMBAT_CONFIG.ATTACKS[attacker.currentAction];
    if (!attackCfg) return;

    // Only strike once per active window: check if defender is invulnerable
    if (defender.invulnerabilityTimer > 0) return;

    // Distance check along combat line
    const dist = Math.abs(attacker.position.x - defender.position.x);
    if (dist <= attackCfg.range) {
      // Calculate damage
      const wasBlocked = defender.isBlocking;
      const wasDodged = defender.actionPhase === 'DODGE';

      if (wasDodged) return;

      let damage = attackCfg.damage;
      let knockback = attackCfg.knockback;

      if (wasBlocked) {
        damage = Math.round(damage * attackCfg.blockDamageMultiplier);
        knockback *= 0.35;
        defender.stamina = Math.max(0, defender.stamina - 10);
      } else {
        // Full hit
        defender.stunTimer = COMBAT_CONFIG.STUN_DURATION_ON_HIT;
        defender.actionPhase = 'STUN';
        defender.currentAction = 'STUN';
        attacker.comboCount += 1;
        attacker.comboTimer = 1.4; // 1.4s combo window
      }

      defender.hp = Math.max(0, defender.hp - damage);
      defender.velocity.x += attacker.facingDirection * knockback * 5;
      defender.invulnerabilityTimer = attackCfg.activeDuration + 0.05; // avoid double hit in same swing

      attacker.totalHitsLanded += 1;
      attacker.totalDamageDealt += damage;

      events.push({
        id: `hit-${this.nextEventId++}`,
        attackerId: attacker.id,
        defenderId: defender.id,
        action: attacker.currentAction,
        damage,
        wasBlocked,
        wasDodged,
        position: {
          x: (attacker.position.x + defender.position.x) / 2,
          y: 1.2,
          z: 0,
        },
        timestamp: Date.now(),
      });
    }
  }

  public reset(): void {
    this.roundTimeRemaining = COMBAT_CONFIG.ROUND_TIME;
    this.isRoundOver = false;
    this.winnerId = null;
    this.player = this.createFighter('p1', this.player.name, true, -2.5, 1);
    this.opponent = this.createFighter('p2', this.opponent.name, false, 2.5, -1);
  }
}
