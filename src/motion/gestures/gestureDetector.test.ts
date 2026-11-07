import test from 'node:test';
import assert from 'node:assert/strict';
import { GestureDetector } from './gestureDetector';
import { Landmark, POSE_LANDMARKS } from '../../types/pose';

// Helper to construct a synthetic 33-landmark skeleton in neutral stance
function createSyntheticNeutralPose(): Landmark[] {
  const landmarks: Landmark[] = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));

  landmarks[POSE_LANDMARKS.NOSE] = { x: 0.5, y: 0.2, z: 0, visibility: 0.99 };
  landmarks[POSE_LANDMARKS.MOUTH_LEFT] = { x: 0.48, y: 0.25, z: 0, visibility: 0.99 };
  landmarks[POSE_LANDMARKS.MOUTH_RIGHT] = { x: 0.52, y: 0.25, z: 0, visibility: 0.99 };

  // Shoulders
  landmarks[POSE_LANDMARKS.LEFT_SHOULDER] = { x: 0.4, y: 0.35, z: 0, visibility: 0.99 };
  landmarks[POSE_LANDMARKS.RIGHT_SHOULDER] = { x: 0.6, y: 0.35, z: 0, visibility: 0.99 };

  // Elbows & Wrists at rest down
  landmarks[POSE_LANDMARKS.LEFT_ELBOW] = { x: 0.38, y: 0.5, z: 0, visibility: 0.99 };
  landmarks[POSE_LANDMARKS.RIGHT_ELBOW] = { x: 0.62, y: 0.5, z: 0, visibility: 0.99 };

  landmarks[POSE_LANDMARKS.LEFT_WRIST] = { x: 0.36, y: 0.65, z: 0, visibility: 0.99 };
  landmarks[POSE_LANDMARKS.RIGHT_WRIST] = { x: 0.64, y: 0.65, z: 0, visibility: 0.99 };

  // Hips
  landmarks[POSE_LANDMARKS.LEFT_HIP] = { x: 0.42, y: 0.6, z: 0, visibility: 0.99 };
  landmarks[POSE_LANDMARKS.RIGHT_HIP] = { x: 0.58, y: 0.6, z: 0, visibility: 0.99 };

  // Knees & Ankles
  landmarks[POSE_LANDMARKS.LEFT_KNEE] = { x: 0.43, y: 0.78, z: 0, visibility: 0.99 };
  landmarks[POSE_LANDMARKS.RIGHT_KNEE] = { x: 0.57, y: 0.78, z: 0, visibility: 0.99 };

  landmarks[POSE_LANDMARKS.LEFT_ANKLE] = { x: 0.44, y: 0.95, z: 0, visibility: 0.99 };
  landmarks[POSE_LANDMARKS.RIGHT_ANKLE] = { x: 0.56, y: 0.95, z: 0, visibility: 0.99 };

  return landmarks;
}

test('GestureDetector recognizes IDLE pose in neutral stance', () => {
  const detector = new GestureDetector();
  const neutral = createSyntheticNeutralPose();

  const frame1 = detector.processRawLandmarks(neutral, 1000);
  assert.equal(frame1 !== null, true);
  if (!frame1) return;

  const result1 = detector.detect(frame1);
  assert.equal(result1.action, 'IDLE');
});

test('GestureDetector detects BLOCK when both hands guard face', () => {
  const detector = new GestureDetector();
  const pose = createSyntheticNeutralPose();

  // Raise wrists close to chin/face level with bent elbows
  pose[POSE_LANDMARKS.LEFT_ELBOW] = { x: 0.45, y: 0.36, z: -0.1, visibility: 0.99 };
  pose[POSE_LANDMARKS.RIGHT_ELBOW] = { x: 0.55, y: 0.36, z: -0.1, visibility: 0.99 };

  pose[POSE_LANDMARKS.LEFT_WRIST] = { x: 0.47, y: 0.25, z: -0.2, visibility: 0.99 };
  pose[POSE_LANDMARKS.RIGHT_WRIST] = { x: 0.53, y: 0.25, z: -0.2, visibility: 0.99 };

  const frame = detector.processRawLandmarks(pose, 1000);
  assert.equal(frame !== null, true);
  if (!frame) return;

  const result = detector.detect(frame);
  assert.equal(result.action, 'BLOCK');
  assert.equal(result.confidence > 0.85, true);
});

test('GestureDetector detects DODGE_LEFT on rapid lateral torso shift', () => {
  const detector = new GestureDetector();
  const pose1 = createSyntheticNeutralPose();
  detector.processRawLandmarks(pose1, 1000);

  // Shift entire torso significantly to the left
  const pose2 = createSyntheticNeutralPose();
  for (const lm of pose2) {
    lm.x -= 0.18;
  }

  const frame2 = detector.processRawLandmarks(pose2, 1033);
  assert.equal(frame2 !== null, true);
  if (!frame2) return;

  const result = detector.detect(frame2, {
    isCalibrated: true,
    neutralTorsoCenter: { x: 0.5, y: 0.5, z: 0 },
    neutralShoulderWidth: 0.2,
    neutralArmReach: 0.3,
    neutralHipCenter: { x: 0.5, y: 0.6, z: 0 },
    minFullBodyVisibility: 0.8,
  });

  assert.equal(result.action, 'DODGE_LEFT');
});

test('GestureDetector detects RIGHT_PUNCH on rapid right wrist extension', () => {
  const detector = new GestureDetector({ punchVelocityThreshold: 1.0 });
  const pose1 = createSyntheticNeutralPose();
  detector.processRawLandmarks(pose1, 1000);

  // Frame 2: Right arm thrusts forward and straightens out rapidly
  const pose2 = createSyntheticNeutralPose();
  // Shoulder stays around 0.6, 0.35
  pose2[POSE_LANDMARKS.RIGHT_ELBOW] = { x: 0.68, y: 0.35, z: -0.2, visibility: 0.99 };
  pose2[POSE_LANDMARKS.RIGHT_WRIST] = { x: 0.88, y: 0.35, z: -0.4, visibility: 0.99 };

  const frame2 = detector.processRawLandmarks(pose2, 1033);
  assert.equal(frame2 !== null, true);
  if (!frame2) return;

  const result = detector.detect(frame2);
  assert.equal(result.action.includes('PUNCH') || result.action.includes('HOOK'), true);
});
