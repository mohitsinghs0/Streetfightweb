/**
 * Multi-Signal Temporal Gesture Recognition Engine
 */

import { ActionType } from '../../types/combat';
import {
  CalibrationData,
  DEFAULT_GESTURE_CONFIG,
  GestureDetectorConfig,
  Landmark,
  POSE_LANDMARKS,
  PoseFrame,
} from '../../types/pose';
import { calculateJointAngle, distance2D } from '../filters/temporalFilter';
import { KalmanFilter3D, AdaptiveAngleEMA } from '../filters/kalmanFilter';

export interface GestureDetectionResult {
  action: ActionType;
  confidence: number;
  reason?: string;
  metrics: {
    leftWristSpeed: number;
    rightWristSpeed: number;
    torsoDisplacementX: number;
    torsoDisplacementY: number;
    leftElbowAngle: number;
    rightElbowAngle: number;
    leftKneeHeight: number;
    rightKneeHeight: number;
  };
}

export class GestureDetector {
  private config: GestureDetectorConfig;
  private prevFrame: PoseFrame | null = null;
  private lastActionTime: number = 0;
  private currentAction: ActionType = 'IDLE';
  private actionCooldownUntil: number = 0;

  // Kalman filters for 3D landmarks (x, y, z)
  private kalmanFilters: Map<number, KalmanFilter3D> = new Map();

  // Adaptive EMA filters for joint angles
  private leftElbowAngleFilter = new AdaptiveAngleEMA(0.25, 0.85);
  private rightElbowAngleFilter = new AdaptiveAngleEMA(0.25, 0.85);
  private leftKneeAngleFilter = new AdaptiveAngleEMA(0.25, 0.85);
  private rightKneeAngleFilter = new AdaptiveAngleEMA(0.25, 0.85);

  // Attack gesture state tracking
  private leftPunchWindup: boolean = false;
  private rightPunchWindup: boolean = false;

  constructor(config: Partial<GestureDetectorConfig> = {}) {
    this.config = { ...DEFAULT_GESTURE_CONFIG, ...config };
  }

  public updateConfig(newConfig: Partial<GestureDetectorConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public resetFilters(): void {
    this.kalmanFilters.forEach(f => f.reset());
    this.leftElbowAngleFilter.reset();
    this.rightElbowAngleFilter.reset();
    this.leftKneeAngleFilter.reset();
    this.rightKneeAngleFilter.reset();
    this.prevFrame = null;
  }

  /**
   * Transforms raw 33 MediaPipe landmarks into a smooth normalized PoseFrame
   * filtered through a state-space Kalman filter to eliminate limb jitter.
   */
  public processRawLandmarks(rawLandmarks: Landmark[], timestamp: number): PoseFrame | null {
    if (!rawLandmarks || rawLandmarks.length < 33) return null;

    // Filter all landmarks using 3D Kalman Filters
    const smoothed: Landmark[] = rawLandmarks.map((lm, idx) => {
      let filter = this.kalmanFilters.get(idx);
      if (!filter) {
        filter = new KalmanFilter3D(0.004, 0.025, 0.012);
        this.kalmanFilters.set(idx, filter);
      }
      return filter.update(lm, timestamp);
    });

    const leftShoulder = smoothed[POSE_LANDMARKS.LEFT_SHOULDER];
    const rightShoulder = smoothed[POSE_LANDMARKS.RIGHT_SHOULDER];
    const leftHip = smoothed[POSE_LANDMARKS.LEFT_HIP];
    const rightHip = smoothed[POSE_LANDMARKS.RIGHT_HIP];
    const leftElbow = smoothed[POSE_LANDMARKS.LEFT_ELBOW];
    const rightElbow = smoothed[POSE_LANDMARKS.RIGHT_ELBOW];
    const leftWrist = smoothed[POSE_LANDMARKS.LEFT_WRIST];
    const rightWrist = smoothed[POSE_LANDMARKS.RIGHT_WRIST];
    const leftKnee = smoothed[POSE_LANDMARKS.LEFT_KNEE];
    const rightKnee = smoothed[POSE_LANDMARKS.RIGHT_KNEE];
    const leftAnkle = smoothed[POSE_LANDMARKS.LEFT_ANKLE];
    const rightAnkle = smoothed[POSE_LANDMARKS.RIGHT_ANKLE];

    // Compute torso center:
    // If hips are reliable in frame, use 4-point midpoint.
    // If half-body (desk/seated mode), project torso from shoulders so leaning & dodging work!
    const hipsReliable = (leftHip.visibility ?? 1) > 0.35 && (rightHip.visibility ?? 1) > 0.35;
    const torsoCenter: Landmark = hipsReliable
      ? {
          x: (leftShoulder.x + rightShoulder.x + leftHip.x + rightHip.x) / 4,
          y: (leftShoulder.y + rightShoulder.y + leftHip.y + rightHip.y) / 4,
          z: ((leftShoulder.z ?? 0) + (rightShoulder.z ?? 0) + (leftHip.z ?? 0) + (rightHip.z ?? 0)) / 4,
        }
      : {
          x: (leftShoulder.x + rightShoulder.x) / 2,
          y: (leftShoulder.y + rightShoulder.y) / 2 + 0.22,
          z: ((leftShoulder.z ?? 0) + (rightShoulder.z ?? 0)) / 2,
        };

    const shoulderWidth = distance2D(leftShoulder, rightShoulder);
    const hipWidth = distance2D(leftHip, rightHip);

    // Compute dt for velocities
    const dt = this.prevFrame ? Math.max((timestamp - this.prevFrame.timestamp) / 1000, 0.001) : 0.033;

    // Compute raw joint angles
    const rawLeftElbowAngle = calculateJointAngle(leftShoulder, leftElbow, leftWrist);
    const rawRightElbowAngle = calculateJointAngle(rightShoulder, rightElbow, rightWrist);
    const rawLeftKneeAngle = calculateJointAngle(leftHip, leftKnee, leftAnkle);
    const rawRightKneeAngle = calculateJointAngle(rightHip, rightKnee, rightAnkle);

    // Compute angular velocity deg/sec for adaptive smoothing
    const prevLEA = this.prevFrame?.leftElbowAngle ?? rawLeftElbowAngle;
    const prevREA = this.prevFrame?.rightElbowAngle ?? rawRightElbowAngle;
    const prevLKA = this.prevFrame?.leftKneeAngle ?? rawLeftKneeAngle;
    const prevRKA = this.prevFrame?.rightKneeAngle ?? rawRightKneeAngle;

    const leAngVel = (rawLeftElbowAngle - prevLEA) / dt;
    const reAngVel = (rawRightElbowAngle - prevREA) / dt;
    const lkAngVel = (rawLeftKneeAngle - prevLKA) / dt;
    const rkAngVel = (rawRightKneeAngle - prevRKA) / dt;

    // Smooth angles with adaptive velocity EMA
    const leftElbowAngle = this.leftElbowAngleFilter.update(rawLeftElbowAngle, leAngVel);
    const rightElbowAngle = this.rightElbowAngleFilter.update(rawRightElbowAngle, reAngVel);
    const leftKneeAngle = this.leftKneeAngleFilter.update(rawLeftKneeAngle, lkAngVel);
    const rightKneeAngle = this.rightKneeAngleFilter.update(rawRightKneeAngle, rkAngVel);

    // Extract velocity estimates: compute from filtered positions across frames
    const calcVel = (curr: Landmark, prev?: Landmark, kf?: KalmanFilter3D) => {
      if (!prev) {
        if (kf) {
          const kfVel = kf.getVelocities();
          const speed = Math.sqrt(kfVel.x * kfVel.x + kfVel.y * kfVel.y + kfVel.z * kfVel.z);
          return { vel: kfVel, speed };
        }
        return { vel: { x: 0, y: 0, z: 0 }, speed: 0 };
      }
      const vx = (curr.x - prev.x) / dt;
      const vy = (curr.y - prev.y) / dt;
      const vz = ((curr.z ?? 0) - (prev.z ?? 0)) / dt;
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      return { vel: { x: vx, y: vy, z: vz }, speed };
    };

    const prevLeftWrist = this.prevFrame?.leftWrist.position;
    const prevRightWrist = this.prevFrame?.rightWrist.position;
    const prevLeftElbow = this.prevFrame?.leftElbow.position;
    const prevRightElbow = this.prevFrame?.rightElbow.position;
    const prevLeftKnee = this.prevFrame?.leftKnee.position;
    const prevRightKnee = this.prevFrame?.rightKnee.position;
    const prevLeftAnkle = this.prevFrame?.leftAnkle.position;
    const prevRightAnkle = this.prevFrame?.rightAnkle.position;
    const prevTorso = this.prevFrame?.torsoCenter;

    const lwVel = calcVel(leftWrist, prevLeftWrist, this.kalmanFilters.get(POSE_LANDMARKS.LEFT_WRIST));
    const rwVel = calcVel(rightWrist, prevRightWrist, this.kalmanFilters.get(POSE_LANDMARKS.RIGHT_WRIST));
    const leVel = calcVel(leftElbow, prevLeftElbow, this.kalmanFilters.get(POSE_LANDMARKS.LEFT_ELBOW));
    const reVel = calcVel(rightElbow, prevRightElbow, this.kalmanFilters.get(POSE_LANDMARKS.RIGHT_ELBOW));
    const lkVel = calcVel(leftKnee, prevLeftKnee, this.kalmanFilters.get(POSE_LANDMARKS.LEFT_KNEE));
    const rkVel = calcVel(rightKnee, prevRightKnee, this.kalmanFilters.get(POSE_LANDMARKS.RIGHT_KNEE));
    const laVel = calcVel(leftAnkle, prevLeftAnkle, this.kalmanFilters.get(POSE_LANDMARKS.LEFT_ANKLE));
    const raVel = calcVel(rightAnkle, prevRightAnkle, this.kalmanFilters.get(POSE_LANDMARKS.RIGHT_ANKLE));
    const tVel = calcVel(torsoCenter, prevTorso);

    // Overall confidence estimate: prioritize upper body so half-body players are never locked out
    const upperVisibilities = [
      leftShoulder.visibility ?? 1,
      rightShoulder.visibility ?? 1,
      leftWrist.visibility ?? 1,
      rightWrist.visibility ?? 1,
    ];
    const upperConfidence = upperVisibilities.reduce((a, b) => a + b, 0) / upperVisibilities.length;
    const bodyVisible = upperConfidence > 0.35;

    const poseFrame: PoseFrame = {
      timestamp,
      landmarks: smoothed,
      confidence: upperConfidence,
      bodyVisible,
      torsoCenter,
      torsoVelocity: tVel.vel,
      shoulderWidth,
      hipWidth,
      leftWrist: { position: leftWrist, velocity: lwVel.vel, speed: lwVel.speed },
      rightWrist: { position: rightWrist, velocity: rwVel.vel, speed: rwVel.speed },
      leftElbow: { position: leftElbow, velocity: leVel.vel, speed: leVel.speed },
      rightElbow: { position: rightElbow, velocity: reVel.vel, speed: reVel.speed },
      leftKnee: { position: leftKnee, velocity: lkVel.vel, speed: lkVel.speed },
      rightKnee: { position: rightKnee, velocity: rkVel.vel, speed: rkVel.speed },
      leftAnkle: { position: leftAnkle, velocity: laVel.vel, speed: laVel.speed },
      rightAnkle: { position: rightAnkle, velocity: raVel.vel, speed: raVel.speed },
      leftElbowAngle,
      rightElbowAngle,
      leftKneeAngle,
      rightKneeAngle,
    };

    this.prevFrame = poseFrame;
    return poseFrame;
  }

  /**
   * Core gesture detection pipeline evaluating multi-signal kinematics
   */
  public detect(
    frame: PoseFrame,
    calibration?: CalibrationData | null
  ): GestureDetectionResult {
    const now = frame.timestamp;

    const neutralTorso = calibration?.isCalibrated
      ? calibration.neutralTorsoCenter
      : { x: 0.5, y: 0.5, z: 0 };

    const torsoDispX = frame.torsoCenter.x - neutralTorso.x;
    const torsoDispY = frame.torsoCenter.y - neutralTorso.y;

    const metrics = {
      leftWristSpeed: frame.leftWrist.speed,
      rightWristSpeed: frame.rightWrist.speed,
      torsoDisplacementX: torsoDispX,
      torsoDisplacementY: torsoDispY,
      leftElbowAngle: frame.leftElbowAngle,
      rightElbowAngle: frame.rightElbowAngle,
      leftKneeHeight: frame.leftKnee.position.y,
      rightKneeHeight: frame.rightKnee.position.y,
    };

    // 1. BLOCK DETECTION (Defensive priority)
    // Both wrists raised above mid-chest and close together in front of head/neck
    const nose = frame.landmarks[POSE_LANDMARKS.NOSE];
    const mouth = frame.landmarks[POSE_LANDMARKS.MOUTH_LEFT];
    const faceRefY = nose ? (nose.y + (mouth ? mouth.y : nose.y)) / 2 : 0.35;

    const leftWristRaised = frame.leftWrist.position.y < frame.landmarks[POSE_LANDMARKS.LEFT_SHOULDER].y + 0.08;
    const rightWristRaised = frame.rightWrist.position.y < frame.landmarks[POSE_LANDMARKS.RIGHT_SHOULDER].y + 0.08;
    const wristsClose = distance2D(frame.leftWrist.position, frame.rightWrist.position) < (frame.shoulderWidth * 1.35 || 0.3);

    if (leftWristRaised && rightWristRaised && wristsClose && frame.leftElbowAngle < 135 && frame.rightElbowAngle < 135) {
      this.currentAction = 'BLOCK';
      return {
        action: 'BLOCK',
        confidence: 0.92,
        reason: 'Dual wrist high guard',
        metrics,
      };
    }

    // Check cooldown for active strike/dodge triggers
    const inCooldown = now < this.actionCooldownUntil;

    // 2. DODGE DETECTION (Body lateral displacement)
    // Lateral displacement of torso or rapid torso velocity
    const absDispX = Math.abs(torsoDispX);
    if (!inCooldown && (absDispX > this.config.dodgeDisplacementThreshold || Math.abs(frame.torsoVelocity.x) > this.config.dodgeVelocityThreshold)) {
      // In webcam mirror: moving right on screen (higher X) means player tilted right
      if (torsoDispX > this.config.dodgeDisplacementThreshold || frame.torsoVelocity.x > this.config.dodgeVelocityThreshold) {
        this.actionCooldownUntil = now + this.config.gestureCooldownMs;
        this.currentAction = 'DODGE_RIGHT';
        return {
          action: 'DODGE_RIGHT',
          confidence: Math.min(0.95, 0.6 + absDispX * 2),
          reason: 'Lateral body shift right',
          metrics,
        };
      } else if (torsoDispX < -this.config.dodgeDisplacementThreshold || frame.torsoVelocity.x < -this.config.dodgeVelocityThreshold) {
        this.actionCooldownUntil = now + this.config.gestureCooldownMs;
        this.currentAction = 'DODGE_LEFT';
        return {
          action: 'DODGE_LEFT',
          confidence: Math.min(0.95, 0.6 + absDispX * 2),
          reason: 'Lateral body shift left',
          metrics,
        };
      }
    }

    // 3. CROUCH DETECTION (Torso significantly lower than neutral)
    if (torsoDispY > 0.14) {
      return {
        action: 'CROUCH',
        confidence: 0.88,
        reason: 'Body dropped below neutral line',
        metrics,
      };
    }

    // 4. KICK DETECTION
    // Knee rises above hip level or ankle thrusts with high velocity
    const leftHip = frame.landmarks[POSE_LANDMARKS.LEFT_HIP];
    const rightHip = frame.landmarks[POSE_LANDMARKS.RIGHT_HIP];
    const leftKneeRaised = frame.leftKnee.position.y < leftHip.y + 0.05 && frame.leftKnee.speed > this.config.kickVelocityThreshold * 0.7;
    const rightKneeRaised = frame.rightKnee.position.y < rightHip.y + 0.05 && frame.rightKnee.speed > this.config.kickVelocityThreshold * 0.7;

    if (!inCooldown && (leftKneeRaised || rightKneeRaised || frame.leftAnkle.speed > this.config.kickVelocityThreshold || frame.rightAnkle.speed > this.config.kickVelocityThreshold)) {
      this.actionCooldownUntil = now + this.config.gestureCooldownMs + 80;
      this.currentAction = 'KICK';
      return {
        action: 'KICK',
        confidence: 0.89,
        reason: 'Leg drive detected',
        metrics,
      };
    }

    // 5. PUNCH DETECTION (Multi-signal: velocity + extension + forward depth direction)
    // Right arm check (mirrored webcam: right arm is on user's right)
    const rightArmFast = frame.rightWrist.speed > this.config.punchVelocityThreshold;
    const rightArmExtended = frame.rightElbowAngle > this.config.punchExtensionThreshold;
    const rightMovingForward = (frame.rightWrist.velocity.z < -this.config.punchZSpeedThreshold) || (frame.rightWrist.speed > 0.45 && frame.rightElbowAngle > 115);

    // Check for hook (lateral arc across body) vs straight cross
    const rightWristVelX = frame.rightWrist.velocity.x;
    const isRightHook = rightArmFast && Math.abs(rightWristVelX) > 0.8 && frame.rightElbowAngle < 155;

    if (!inCooldown && (rightArmFast || rightMovingForward) && (rightArmExtended || isRightHook || rightMovingForward)) {
      this.actionCooldownUntil = now + this.config.gestureCooldownMs;
      const punchAction = isRightHook ? 'RIGHT_HOOK' : 'RIGHT_PUNCH';
      this.currentAction = punchAction;
      return {
        action: punchAction,
        confidence: Math.min(0.96, 0.75 + frame.rightWrist.speed * 0.2),
        reason: isRightHook ? 'Rotational right hook' : 'Straight right punch strike',
        metrics,
      };
    }

    // Left arm check
    const leftArmFast = frame.leftWrist.speed > this.config.punchVelocityThreshold;
    const leftArmExtended = frame.leftElbowAngle > this.config.punchExtensionThreshold;
    const leftMovingForward = (frame.leftWrist.velocity.z < -this.config.punchZSpeedThreshold) || (frame.leftWrist.speed > 0.45 && frame.leftElbowAngle > 115);
    const leftWristVelX = frame.leftWrist.velocity.x;
    const isLeftHook = leftArmFast && Math.abs(leftWristVelX) > 0.8 && frame.leftElbowAngle < 155;

    if (!inCooldown && (leftArmFast || leftMovingForward) && (leftArmExtended || isLeftHook || leftMovingForward)) {
      this.actionCooldownUntil = now + this.config.gestureCooldownMs;
      const punchAction = isLeftHook ? 'LEFT_HOOK' : 'LEFT_PUNCH';
      this.currentAction = punchAction;
      return {
        action: punchAction,
        confidence: Math.min(0.96, 0.75 + frame.leftWrist.speed * 0.2),
        reason: isLeftHook ? 'Rotational left hook' : 'Fast left jab strike',
        metrics,
      };
    }

    // 6. MOVEMENT (FORWARD / BACKWARD)
    if (calibration?.isCalibrated) {
      const scaleRatio = frame.shoulderWidth / (calibration.neutralShoulderWidth || 0.25);
      if (scaleRatio > 1.25) {
        return { action: 'MOVE_FORWARD', confidence: 0.8, reason: 'Stepping toward camera', metrics };
      } else if (scaleRatio < 0.78) {
        return { action: 'MOVE_BACKWARD', confidence: 0.8, reason: 'Stepping back', metrics };
      }
    }

    this.currentAction = 'IDLE';
    return {
      action: 'IDLE',
      confidence: 1.0,
      metrics,
    };
  }

  public reset(): void {
    this.prevFrame = null;
    this.lastActionTime = 0;
    this.actionCooldownUntil = 0;
    this.currentAction = 'IDLE';
    this.resetFilters();
  }
}
