/**
 * Motion Calibration Manager
 * Establishes neutral body baseline, reach scale, and center threshold
 */

import { CalibrationData, PoseFrame } from '../../types/pose';

const STORAGE_KEY = 'kinetic_clash_calibration';

export class CalibrationManager {
  private calibration: CalibrationData = {
    isCalibrated: false,
    neutralTorsoCenter: { x: 0.5, y: 0.5, z: 0 },
    neutralShoulderWidth: 0.22,
    neutralArmReach: 0.35,
    neutralHipCenter: { x: 0.5, y: 0.6, z: 0 },
    minFullBodyVisibility: 0.8,
  };

  private samples: PoseFrame[] = [];

  constructor() {
    this.loadFromStorage();
  }

  public getCalibration(): CalibrationData {
    return this.calibration;
  }

  public startSampling(): void {
    this.samples = [];
  }

  public addSample(frame: PoseFrame): void {
    if (frame.confidence > 0.65) {
      this.samples.push(frame);
    }
  }

  public finalizeCalibration(): CalibrationData {
    if (this.samples.length < 5) {
      // Use defaults
      this.calibration.isCalibrated = true;
      return this.calibration;
    }

    let avgTorsoX = 0;
    let avgTorsoY = 0;
    let avgShoulderW = 0;

    for (const s of this.samples) {
      avgTorsoX += s.torsoCenter.x;
      avgTorsoY += s.torsoCenter.y;
      avgShoulderW += s.shoulderWidth;
    }

    const count = this.samples.length;
    this.calibration = {
      isCalibrated: true,
      neutralTorsoCenter: { x: avgTorsoX / count, y: avgTorsoY / count, z: 0 },
      neutralShoulderWidth: avgShoulderW / count,
      neutralArmReach: (avgShoulderW / count) * 1.5,
      neutralHipCenter: { x: avgTorsoX / count, y: avgTorsoY / count + 0.15, z: 0 },
      minFullBodyVisibility: 0.75,
    };

    this.saveToStorage();
    return this.calibration;
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.calibration));
    } catch {
      // Storage unavailable
    }
  }

  private loadFromStorage(): void {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        this.calibration = JSON.parse(data);
      }
    } catch {
      // Ignore
    }
  }
}

export const calibrationManager = new CalibrationManager();
