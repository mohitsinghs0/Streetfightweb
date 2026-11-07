import test from 'node:test';
import assert from 'node:assert/strict';
import { KalmanFilter1D, KalmanFilter3D, AdaptiveAngleEMA } from './kalmanFilter';
import { Landmark } from '../../types/pose';

test('KalmanFilter1D filters out high-frequency noise from static signal', () => {
  const filter = new KalmanFilter1D(0.001, 0.01, 0.05);

  const trueValue = 0.5;
  const noisyMeasurements = [0.5, 0.54, 0.46, 0.55, 0.45, 0.53, 0.47, 0.52, 0.48, 0.51];

  let sumRawDiff = 0;
  let sumFilteredDiff = 0;

  noisyMeasurements.forEach((val, idx) => {
    const res = filter.update(val, 1000 + idx * 33);
    sumRawDiff += Math.abs(val - trueValue);
    sumFilteredDiff += Math.abs(res.position - trueValue);
  });

  // Filtered signal error should be noticeably lower than raw noisy measurements
  assert.equal(sumFilteredDiff < sumRawDiff, true);
});

test('KalmanFilter3D tracks 3D coordinates and provides velocity estimates', () => {
  const kf3d = new KalmanFilter3D();

  // Simulate a hand punching forward from z=0 to z=-0.3 over 5 frames
  let lastRes: Landmark = { x: 0, y: 0, z: 0 };
  for (let i = 0; i <= 6; i++) {
    const lm: Landmark = {
      x: 0.6,
      y: 0.4,
      z: -0.06 * i,
      visibility: 0.99,
    };
    lastRes = kf3d.update(lm, 1000 + i * 33);
  }

  assert.equal(lastRes.x > 0.58 && lastRes.x < 0.62, true);
  assert.equal(lastRes.z! < -0.25, true);

  // Velocity in Z should be negative (moving forward into camera)
  const vels = kf3d.getVelocities();
  assert.equal(vels.z < 0, true);
});

test('AdaptiveAngleEMA smooths joint angles adaptively', () => {
  const ema = new AdaptiveAngleEMA(0.2, 0.8);

  const angle1 = ema.update(90, 0);
  assert.equal(angle1, 90);

  // Small perturbation with low velocity gets smoothed heavily
  const angle2 = ema.update(95, 10);
  // With alpha around 0.2: 0.2*95 + 0.8*90 = 91
  assert.equal(angle2 < 93, true);

  // High speed strike angle update (300 deg/s) adapts to higher alpha
  const angle3 = ema.update(160, 300);
  assert.equal(angle3 > 140, true);
});
