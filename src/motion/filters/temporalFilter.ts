/**
 * Temporal and Low-Pass Filters for Pose Landmarks & Kinematics
 */

import { Landmark } from '../../types/pose';

/**
 * Calculates 3D distance between two landmarks
 */
export function distance3D(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Calculates 2D Euclidean distance
 */
export function distance2D(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculates the interior angle in degrees between three landmarks: A - B - C (angle at joint B)
 */
export function calculateJointAngle(a: Landmark, b: Landmark, c: Landmark): number {
  const ab = { x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) };
  const cb = { x: c.x - b.x, y: c.y - b.y, z: (c.z ?? 0) - (b.z ?? 0) };

  const dot = ab.x * cb.x + ab.y * cb.y + ab.z * cb.z;
  const magAB = Math.sqrt(ab.x * ab.x + ab.y * ab.y + ab.z * ab.z);
  const magCB = Math.sqrt(cb.x * cb.x + cb.y * cb.y + cb.z * cb.z);

  if (magAB === 0 || magCB === 0) return 180;

  const cosTheta = Math.max(-1, Math.min(1, dot / (magAB * magCB)));
  return (Math.acos(cosTheta) * 180) / Math.PI;
}

/**
 * 1€ (One Euro) Filter implementation for low-latency jitter reduction.
 * High-speed movements have high cutoff (fast responsiveness),
 * Low-speed jitter is smoothed out with low cutoff.
 */
export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private xPrev: number | null = null;
  private dxPrev: number = 0;
  private tPrev: number | null = null;

  constructor(minCutoff: number = 1.0, beta: number = 0.007, dCutoff: number = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private alpha(cutoff: number, dt: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  public filter(val: number, timestamp: number): number {
    if (this.tPrev === null || this.xPrev === null) {
      this.xPrev = val;
      this.tPrev = timestamp;
      this.dxPrev = 0;
      return val;
    }

    const dt = Math.max((timestamp - this.tPrev) / 1000, 0.001);
    this.tPrev = timestamp;

    // Filter derivative (velocity)
    const dx = (val - this.xPrev) / dt;
    const aD = this.alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    this.dxPrev = dxHat;

    // Adaptive cutoff based on velocity
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this.alpha(cutoff, dt);
    const xHat = a * val + (1 - a) * this.xPrev;
    this.xPrev = xHat;

    return xHat;
  }

  public reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
}

/**
 * 3D Landmark Filter using 3 OneEuroFilter instances
 */
export class LandmarkFilter3D {
  private fx = new OneEuroFilter(1.2, 0.015, 1.0);
  private fy = new OneEuroFilter(1.2, 0.015, 1.0);
  private fz = new OneEuroFilter(1.2, 0.02, 1.0);

  public filter(p: Landmark, timestamp: number): Landmark {
    return {
      x: this.fx.filter(p.x, timestamp),
      y: this.fy.filter(p.y, timestamp),
      z: this.fz.filter(p.z ?? 0, timestamp),
      visibility: p.visibility,
    };
  }

  public reset(): void {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
  }
}
