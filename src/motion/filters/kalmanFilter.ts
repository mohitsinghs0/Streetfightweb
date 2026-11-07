/**
 * Kalman Filter & Adaptive Exponential Moving Average (EMA)
 * Optimal state estimation for 3D pose landmarks and joint angles.
 * Reduces webcam sensor noise and eliminates limb jitter for fluid 3D character animation.
 */

import { Landmark } from '../../types/pose';

/**
 * 1D Linear Kalman Filter with position and velocity state
 * State: [x, v]^T
 */
export class KalmanFilter1D {
  private x: number = 0; // estimated position
  private v: number = 0; // estimated velocity
  private p11: number = 1.0; // position variance
  private p12: number = 0.0;
  private p21: number = 0.0;
  private p22: number = 1.0; // velocity variance

  private qPos: number; // process noise position
  private qVel: number; // process noise velocity
  private rMeas: number; // measurement noise

  private initialized: boolean = false;
  private lastTimestamp: number = 0;

  constructor(
    processNoisePos: number = 0.005,
    processNoiseVel: number = 0.02,
    measurementNoise: number = 0.015
  ) {
    this.qPos = processNoisePos;
    this.qVel = processNoiseVel;
    this.rMeas = measurementNoise;
  }

  public update(measurement: number, timestamp: number): { position: number; velocity: number } {
    if (!this.initialized) {
      this.x = measurement;
      this.v = 0;
      this.lastTimestamp = timestamp;
      this.initialized = true;
      return { position: this.x, velocity: this.v };
    }

    const dt = Math.max((timestamp - this.lastTimestamp) / 1000, 0.001);
    this.lastTimestamp = timestamp;

    // 1. Predict Step
    // x_pred = x + v * dt
    const xPred = this.x + this.v * dt;
    const vPred = this.v;

    // P_pred = F * P * F^T + Q
    const p11Pred = this.p11 + dt * (this.p21 + this.p12) + dt * dt * this.p22 + this.qPos;
    const p12Pred = this.p12 + dt * this.p22;
    const p21Pred = this.p21 + dt * this.p22;
    const p22Pred = this.p22 + this.qVel;

    // 2. Innovation / Measurement Residual
    const y = measurement - xPred;
    const s = p11Pred + this.rMeas;

    // 3. Kalman Gain
    const k1 = p11Pred / s;
    const k2 = p21Pred / s;

    // 4. Update Step
    this.x = xPred + k1 * y;
    this.v = vPred + k2 * y;

    // Updated Covariance: P = (I - K*H) * P_pred
    this.p11 = p11Pred - k1 * p11Pred;
    this.p12 = p12Pred - k1 * p12Pred;
    this.p21 = p21Pred - k2 * p11Pred;
    this.p22 = p22Pred - k2 * p12Pred;

    return { position: this.x, velocity: this.v };
  }

  public getPosition(): number {
    return this.x;
  }

  public getVelocity(): number {
    return this.v;
  }

  public reset(): void {
    this.initialized = false;
    this.x = 0;
    this.v = 0;
    this.p11 = 1.0;
    this.p12 = 0.0;
    this.p21 = 0.0;
    this.p22 = 1.0;
    this.lastTimestamp = 0;
  }
}

/**
 * 3D Kalman Filter tracking 3D Landmark coordinates [x, y, z]
 */
export class KalmanFilter3D {
  private kx: KalmanFilter1D;
  private ky: KalmanFilter1D;
  private kz: KalmanFilter1D;

  constructor(
    processNoisePos: number = 0.004,
    processNoiseVel: number = 0.025,
    measurementNoise: number = 0.012
  ) {
    this.kx = new KalmanFilter1D(processNoisePos, processNoiseVel, measurementNoise);
    this.ky = new KalmanFilter1D(processNoisePos, processNoiseVel, measurementNoise);
    this.kz = new KalmanFilter1D(processNoisePos * 1.5, processNoiseVel * 1.5, measurementNoise * 2.0);
  }

  public update(lm: Landmark, timestamp: number): Landmark {
    const rx = this.kx.update(lm.x, timestamp);
    const ry = this.ky.update(lm.y, timestamp);
    const rz = this.kz.update(lm.z ?? 0, timestamp);

    return {
      x: rx.position,
      y: ry.position,
      z: rz.position,
      visibility: lm.visibility,
    };
  }

  public getVelocities(): { x: number; y: number; z: number } {
    return {
      x: this.kx.getVelocity(),
      y: this.ky.getVelocity(),
      z: this.kz.getVelocity(),
    };
  }

  public reset(): void {
    this.kx.reset();
    this.ky.reset();
    this.kz.reset();
  }
}

/**
 * Velocity-Adaptive Exponential Moving Average (EMA) for joint angles
 */
export class AdaptiveAngleEMA {
  private filteredAngle: number | null = null;
  private minAlpha: number; // smoothing for static pose (e.g. 0.25)
  private maxAlpha: number; // responsiveness for fast strike (e.g. 0.85)

  constructor(minAlpha: number = 0.25, maxAlpha: number = 0.85) {
    this.minAlpha = minAlpha;
    this.maxAlpha = maxAlpha;
  }

  public update(currentAngle: number, angularVelocityDegPerSec: number = 0): number {
    if (this.filteredAngle === null) {
      this.filteredAngle = currentAngle;
      return currentAngle;
    }

    // Adaptive alpha: fast movement gets higher alpha to eliminate lag,
    // slow movement gets lower alpha to eliminate noise jitter
    const speedRatio = Math.min(1.0, Math.abs(angularVelocityDegPerSec) / 280);
    const alpha = this.minAlpha + speedRatio * (this.maxAlpha - this.minAlpha);

    this.filteredAngle = alpha * currentAngle + (1 - alpha) * this.filteredAngle;
    return this.filteredAngle;
  }

  public reset(): void {
    this.filteredAngle = null;
  }
}
