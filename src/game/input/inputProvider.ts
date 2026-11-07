/**
 * Unified Input Provider Abstraction
 * Handles both Camera-driven gestures and Keyboard fallback seamlessly.
 */

import { ActionType, GameInput } from '../../types/combat';
import { GestureDetector } from '../../motion/gestures/gestureDetector';
import { CalibrationData, PoseFrame } from '../../types/pose';

export interface InputProvider {
  getCurrentInput(): GameInput;
  pollActionEvents(): GameInput[];
  dispose(): void;
}

/**
 * Keyboard Input Provider (Developer testing, accessibility, automated tests)
 * W: Move Forward, S: Move Backward
 * A: Dodge Left, D: Dodge Right
 * J: Left Punch, K: Right Punch
 * L: Kick
 * Space: Block
 */
export class KeyboardInputProvider implements InputProvider {
  private activeKeys: Set<string> = new Set();
  private pendingEvents: GameInput[] = [];
  private onKeyDown: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  private onBlur: () => void;

  constructor() {
    this.onKeyDown = (e: KeyboardEvent) => {
      const code = e.code;
      if (this.activeKeys.has(code)) return; // prevent key repeat
      this.activeKeys.add(code);

      const input = this.mapCodeToAction(code);
      if (input) {
        this.pendingEvents.push(input);
      }
    };

    this.onKeyUp = (e: KeyboardEvent) => {
      this.activeKeys.delete(e.code);
    };

    this.onBlur = () => {
      this.activeKeys.clear();
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  private mapCodeToAction(code: string): GameInput | null {
    const timestamp = Date.now();
    switch (code) {
      case 'KeyJ':
        return { action: 'LEFT_PUNCH', confidence: 1.0, source: 'keyboard', timestamp };
      case 'KeyK':
        return { action: 'RIGHT_PUNCH', confidence: 1.0, source: 'keyboard', timestamp };
      case 'KeyL':
        return { action: 'KICK', confidence: 1.0, source: 'keyboard', timestamp };
      case 'KeyA':
      case 'ArrowLeft':
        return { action: 'DODGE_LEFT', confidence: 1.0, source: 'keyboard', timestamp };
      case 'KeyD':
      case 'ArrowRight':
        return { action: 'DODGE_RIGHT', confidence: 1.0, source: 'keyboard', timestamp };
      case 'Space':
        return { action: 'BLOCK', confidence: 1.0, source: 'keyboard', timestamp };
      case 'KeyW':
      case 'ArrowUp':
        return { action: 'MOVE_FORWARD', confidence: 1.0, source: 'keyboard', timestamp };
      case 'KeyS':
      case 'ArrowDown':
        return { action: 'MOVE_BACKWARD', confidence: 1.0, source: 'keyboard', timestamp };
      default:
        return null;
    }
  }

  public getCurrentInput(): GameInput {
    const timestamp = Date.now();
    if (this.activeKeys.has('Space')) {
      return { action: 'BLOCK', confidence: 1.0, source: 'keyboard', timestamp };
    }
    if (this.activeKeys.has('KeyW') || this.activeKeys.has('ArrowUp')) {
      return { action: 'MOVE_FORWARD', confidence: 1.0, source: 'keyboard', timestamp };
    }
    if (this.activeKeys.has('KeyS') || this.activeKeys.has('ArrowDown')) {
      return { action: 'MOVE_BACKWARD', confidence: 1.0, source: 'keyboard', timestamp };
    }
    return { action: 'IDLE', confidence: 1.0, source: 'keyboard', timestamp };
  }

  public pollActionEvents(): GameInput[] {
    const events = [...this.pendingEvents];
    this.pendingEvents = [];
    return events;
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.activeKeys.clear();
  }
}

/**
 * Camera Input Provider
 * Bridges Pose Landmark stream to game action events
 */
export class CameraInputProvider implements InputProvider {
  private detector: GestureDetector;
  private pendingEvents: GameInput[] = [];
  private lastAction: ActionType = 'IDLE';
  private calibration: CalibrationData | null = null;

  constructor(detector: GestureDetector, calibration?: CalibrationData) {
    this.detector = detector;
    this.calibration = calibration || null;
  }

  public setCalibration(calibration: CalibrationData): void {
    this.calibration = calibration;
  }

  public feedPose(frame: PoseFrame): void {
    const result = this.detector.detect(frame, this.calibration);
    if (result.action !== 'IDLE' && result.action !== this.lastAction) {
      this.pendingEvents.push({
        action: result.action,
        confidence: result.confidence,
        source: 'camera',
        timestamp: frame.timestamp,
      });
    }
    this.lastAction = result.action;
  }

  public getCurrentInput(): GameInput {
    return {
      action: this.lastAction,
      confidence: 0.9,
      source: 'camera',
      timestamp: Date.now(),
    };
  }

  public pollActionEvents(): GameInput[] {
    const events = [...this.pendingEvents];
    this.pendingEvents = [];
    return events;
  }

  public dispose(): void {
    this.pendingEvents = [];
    this.lastAction = 'IDLE';
  }
}
