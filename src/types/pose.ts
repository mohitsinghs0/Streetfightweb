/**
 * Normalized Pose and Landmark Types for Camera-Driven Motion
 */

export interface Landmark {
  x: number; // 0 to 1 (horizontal, normalized)
  y: number; // 0 to 1 (vertical, normalized, 0 = top)
  z: number; // depth estimate (smaller is closer to camera)
  visibility?: number; // 0 to 1
}

// MediaPipe 33 Landmark indices constants
export const POSE_LANDMARKS = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

export interface JointMetrics {
  position: Landmark;
  velocity: { x: number; y: number; z: number };
  speed: number;
}

export interface PoseFrame {
  timestamp: number;
  landmarks: Landmark[];
  confidence: number;
  bodyVisible: boolean;
  torsoCenter: Landmark;
  torsoVelocity: { x: number; y: number; z: number };
  shoulderWidth: number;
  hipWidth: number;
  leftWrist: JointMetrics;
  rightWrist: JointMetrics;
  leftElbow: JointMetrics;
  rightElbow: JointMetrics;
  leftKnee: JointMetrics;
  rightKnee: JointMetrics;
  leftAnkle: JointMetrics;
  rightAnkle: JointMetrics;
  // Computed body angles in degrees
  leftElbowAngle: number;
  rightElbowAngle: number;
  leftKneeAngle: number;
  rightKneeAngle: number;
}

export interface CalibrationData {
  isCalibrated: boolean;
  neutralTorsoCenter: Landmark;
  neutralShoulderWidth: number;
  neutralArmReach: number;
  neutralHipCenter: Landmark;
  minFullBodyVisibility: number;
}

export interface GestureDetectorConfig {
  punchVelocityThreshold: number; // minimum wrist speed in normalized units/s
  punchExtensionThreshold: number; // elbow angle > degrees
  punchZSpeedThreshold: number; // forward z movement
  blockWristHeightRatio: number; // wrists above nose/mouth
  blockWristProximityRatio: number; // distance between wrists
  dodgeDisplacementThreshold: number; // lateral torso offset from neutral
  dodgeVelocityThreshold: number;
  kickKneeHeightThreshold: number; // knee rises above hip
  kickVelocityThreshold: number;
  gestureCooldownMs: number;
}

export const DEFAULT_GESTURE_CONFIG: GestureDetectorConfig = {
  punchVelocityThreshold: 0.55, // lowered from 1.15 so natural punches trigger easily
  punchExtensionThreshold: 120, // lowered from 140 to account for front-facing camera perspective
  punchZSpeedThreshold: 0.18, // forward z thrust into camera
  blockWristHeightRatio: 0.85,
  blockWristProximityRatio: 0.35,
  dodgeDisplacementThreshold: 0.08, // lowered from 0.12
  dodgeVelocityThreshold: 0.45,
  kickKneeHeightThreshold: 0.72,
  kickVelocityThreshold: 0.65,
  gestureCooldownMs: 220,
};

export interface RecordedGestureFrame {
  timestamp: number;
  landmarks: Landmark[];
  detectedGesture: string;
}

export interface GestureRecording {
  id: string;
  label: string;
  recordedAt: string;
  frameCount: number;
  durationMs: number;
  frames: RecordedGestureFrame[];
}
