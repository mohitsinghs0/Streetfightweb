/**
 * MediaPipe Pose Landmarker Wrapper & Local Video Processor
 * Privacy guarantee: Video stream is strictly processed in local memory.
 */

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { Landmark, POSE_LANDMARKS } from '../../types/pose';

// MediaPipe standard skeletal connection pairs
export const POSE_CONNECTIONS: [number, number][] = [
  // Face
  [POSE_LANDMARKS.LEFT_EYE, POSE_LANDMARKS.NOSE],
  [POSE_LANDMARKS.RIGHT_EYE, POSE_LANDMARKS.NOSE],
  [POSE_LANDMARKS.LEFT_EYE, POSE_LANDMARKS.LEFT_EAR],
  [POSE_LANDMARKS.RIGHT_EYE, POSE_LANDMARKS.RIGHT_EAR],
  [POSE_LANDMARKS.MOUTH_LEFT, POSE_LANDMARKS.MOUTH_RIGHT],
  // Upper body
  [POSE_LANDMARKS.LEFT_SHOULDER, POSE_LANDMARKS.RIGHT_SHOULDER],
  [POSE_LANDMARKS.LEFT_SHOULDER, POSE_LANDMARKS.LEFT_ELBOW],
  [POSE_LANDMARKS.LEFT_ELBOW, POSE_LANDMARKS.LEFT_WRIST],
  [POSE_LANDMARKS.RIGHT_SHOULDER, POSE_LANDMARKS.RIGHT_ELBOW],
  [POSE_LANDMARKS.RIGHT_ELBOW, POSE_LANDMARKS.RIGHT_WRIST],
  // Hands
  [POSE_LANDMARKS.LEFT_WRIST, POSE_LANDMARKS.LEFT_PINKY],
  [POSE_LANDMARKS.LEFT_WRIST, POSE_LANDMARKS.LEFT_INDEX],
  [POSE_LANDMARKS.LEFT_WRIST, POSE_LANDMARKS.LEFT_THUMB],
  [POSE_LANDMARKS.RIGHT_WRIST, POSE_LANDMARKS.RIGHT_PINKY],
  [POSE_LANDMARKS.RIGHT_WRIST, POSE_LANDMARKS.RIGHT_INDEX],
  [POSE_LANDMARKS.RIGHT_WRIST, POSE_LANDMARKS.RIGHT_THUMB],
  // Torso
  [POSE_LANDMARKS.LEFT_SHOULDER, POSE_LANDMARKS.LEFT_HIP],
  [POSE_LANDMARKS.RIGHT_SHOULDER, POSE_LANDMARKS.RIGHT_HIP],
  [POSE_LANDMARKS.LEFT_HIP, POSE_LANDMARKS.RIGHT_HIP],
  // Legs
  [POSE_LANDMARKS.LEFT_HIP, POSE_LANDMARKS.LEFT_KNEE],
  [POSE_LANDMARKS.LEFT_KNEE, POSE_LANDMARKS.LEFT_ANKLE],
  [POSE_LANDMARKS.LEFT_ANKLE, POSE_LANDMARKS.LEFT_HEEL],
  [POSE_LANDMARKS.LEFT_HEEL, POSE_LANDMARKS.LEFT_FOOT_INDEX],
  [POSE_LANDMARKS.RIGHT_HIP, POSE_LANDMARKS.RIGHT_KNEE],
  [POSE_LANDMARKS.RIGHT_KNEE, POSE_LANDMARKS.RIGHT_ANKLE],
  [POSE_LANDMARKS.RIGHT_ANKLE, POSE_LANDMARKS.RIGHT_HEEL],
];

export interface BodyExposureReport {
  headVisible: boolean;
  shouldersVisible: boolean;
  wristsVisible: boolean;
  hipsVisible: boolean;
  kneesVisible: boolean;
  feetVisible: boolean;
  halfBodyExposed: boolean;
  fullBodyExposed: boolean;
  trackingMode: 'HALF_BODY' | 'FULL_BODY' | 'NO_BODY';
  exposureScore: number; // 0 - 100
  distance: 'TOO_CLOSE' | 'TOO_FAR' | 'GOOD';
  horizontalAlignment: 'CENTERED' | 'MOVE_LEFT' | 'MOVE_RIGHT';
  guidanceMessage: string;
  suggestedAction: string;
}

export class CameraPoseService {
  private landmarker: PoseLandmarker | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private isInitializing: boolean = false;
  private isRunning: boolean = false;
  private lastVideoTime: number = -1;
  private animationFrameId: number = 0;

  // Performance telemetry
  private fps: number = 0;
  private latencyMs: number = 0;
  private frameCount: number = 0;
  private lastFpsTimestamp: number = 0;

  // Simulation mode
  private isSimulated: boolean = false;
  private simTime: number = 0;
  private cameraErrorCode: string | null = null;

  public isAiModelLoading(): boolean {
    return this.isInitializing;
  }

  public async initialize(): Promise<void> {
    if (this.landmarker || this.isInitializing) return;
    this.isInitializing = true;

    try {
      // Race network download with a 7s safety limit
      const initPromise = (async () => {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );

        try {
          return await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        } catch (gpuErr) {
          console.warn('MediaPipe GPU delegate initialization failed, trying CPU:', gpuErr);
          return await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        }
      })();

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('MediaPipe download timeout')), 7000)
      );

      this.landmarker = await Promise.race([initPromise, timeoutPromise]);
    } catch (err) {
      console.warn('MediaPipe initialization fallback to simulation mode:', err);
      // Fallback so gestures and postures still work even if Google storage CDN is slow/blocked
      this.isSimulated = true;
    } finally {
      this.isInitializing = false;
    }
  }

  public async startCamera(videoEl: HTMLVideoElement, deviceId?: string): Promise<boolean> {
    this.videoElement = videoEl;
    this.cameraErrorCode = null;

    // Fast path: if stream is already live, reattach to this video element immediately
    if (this.stream && this.stream.active) {
      const tracks = this.stream.getVideoTracks();
      if (tracks.length > 0 && tracks[0].readyState === 'live') {
        videoEl.srcObject = this.stream;
        videoEl.muted = true;
        (videoEl as any).defaultMuted = true;
        videoEl.playsInline = true;
        try {
          await videoEl.play();
        } catch {
          // ignore
        }
        this.isRunning = true;
        this.cameraErrorCode = null;
        return true;
      }
    }

    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera getUserMedia API not supported in this browser environment');
      }

      // Stop previous tracks cleanly if inactive
      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
      }

      // Try with preferred constraints first, then fallback to basic { video: true }
      let activeStream: MediaStream;
      try {
        const constraints: MediaStreamConstraints = {
          video: deviceId
            ? { deviceId: { exact: deviceId } }
            : { width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        };
        activeStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (constraintErr) {
        console.warn('Detailed camera constraints failed, attempting fallback to { video: true }:', constraintErr);
        activeStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      this.stream = activeStream;

      videoEl.srcObject = this.stream;
      videoEl.setAttribute('autoplay', '');
      videoEl.setAttribute('playsinline', '');
      videoEl.setAttribute('muted', '');
      videoEl.muted = true;
      (videoEl as any).defaultMuted = true;
      videoEl.playsInline = true;

      try {
        await videoEl.play();
      } catch (playErr) {
        console.warn('Initial video.play() waiting on events:', playErr);
      }

      await new Promise<void>((resolve) => {
        if (videoEl.readyState >= 2) {
          resolve();
          return;
        }

        let resolved = false;
        const done = () => {
          if (resolved) return;
          resolved = true;
          videoEl.removeEventListener('loadedmetadata', done);
          videoEl.removeEventListener('canplay', done);
          videoEl.removeEventListener('playing', done);
          videoEl.play().catch(() => {});
          resolve();
        };

        videoEl.addEventListener('loadedmetadata', done);
        videoEl.addEventListener('canplay', done);
        videoEl.addEventListener('playing', done);

        // Safety timeout
        setTimeout(done, 1000);
      });

      this.isRunning = true;
      this.isSimulated = false; // Real camera active!
      this.cameraErrorCode = null;
      return true;
    } catch (err: any) {
      console.warn('Camera access error:', err);
      let code = 'UNKNOWN_ERROR';
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        code = 'PERMISSION_DENIED';
      } else if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
        code = 'CAMERA_IN_USE';
      } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
        code = 'NO_CAMERA_FOUND';
      }
      this.cameraErrorCode = code;
      this.isRunning = false;
      return false;
    }
  }

  public stop(): void {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = 0;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
  }

  public getCameraErrorCode(): string | null {
    return this.cameraErrorCode;
  }

  public isCameraRunning(): boolean {
    return Boolean(this.stream && this.stream.active && this.isRunning);
  }

  public isAiModelLoaded(): boolean {
    return Boolean(this.landmarker);
  }

  public enableSimulationMode(enable: boolean = true) {
    this.isSimulated = enable;
    if (enable) {
      this.isRunning = true;
    }
  }

  public processFrame(onLandmarks: (landmarks: Landmark[], timestamp: number) => void): void {
    if (!this.isRunning) {
      onLandmarks([], Date.now());
      return;
    }

    const startT = performance.now();
    const now = Date.now();

    // FPS calculation
    this.frameCount++;
    if (now - this.lastFpsTimestamp >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsTimestamp = now;
    }

    // 1. Real Camera + MediaPipe Video Detection
    if (
      !this.isSimulated &&
      this.stream &&
      this.landmarker &&
      this.videoElement &&
      this.videoElement.readyState >= 2 &&
      this.videoElement.currentTime !== this.lastVideoTime
    ) {
      this.lastVideoTime = this.videoElement.currentTime;

      try {
        const result = this.landmarker.detectForVideo(this.videoElement, now);
        this.latencyMs = Math.round(performance.now() - startT);

        if (result && result.landmarks && result.landmarks.length > 0) {
          const lms: Landmark[] = result.landmarks[0].map((pt) => ({
            x: pt.x,
            y: pt.y,
            z: pt.z,
            visibility: pt.visibility ?? 1,
          }));
          onLandmarks(lms, now);
          return;
        } else {
          // Out of frame
          onLandmarks([], now);
          return;
        }
      } catch {
        // Fallback for transient frame processing
      }
    }

    // 2. Synthetic fallback (ONLY if explicitly in simulation mode or headless)
    if (this.isSimulated) {
      this.simTime += 0.033;
      const simLandmarks = this.generateSyntheticPose(this.simTime);
      this.latencyMs = Math.round(performance.now() - startT);
      onLandmarks(simLandmarks, now);
      return;
    }

    onLandmarks([], now);
  }

  public getTelemetry(): { fps: number; latencyMs: number; isSimulated: boolean; isCameraActive: boolean } {
    return {
      fps: this.fps,
      latencyMs: this.latencyMs,
      isSimulated: this.isSimulated,
      isCameraActive: this.isCameraRunning(),
    };
  }

  public generateSyntheticPose(time: number, overrideAction?: string): Landmark[] {
    const lms: Landmark[] = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.98 }));
    const breath = Math.sin(time * 2) * 0.015;

    // Head
    lms[POSE_LANDMARKS.NOSE] = { x: 0.5, y: 0.22 + breath, z: 0, visibility: 0.99 };
    lms[POSE_LANDMARKS.LEFT_EYE] = { x: 0.48, y: 0.2 + breath, z: -0.02, visibility: 0.99 };
    lms[POSE_LANDMARKS.RIGHT_EYE] = { x: 0.52, y: 0.2 + breath, z: -0.02, visibility: 0.99 };
    lms[POSE_LANDMARKS.LEFT_EAR] = { x: 0.44, y: 0.22 + breath, z: 0.05, visibility: 0.98 };
    lms[POSE_LANDMARKS.RIGHT_EAR] = { x: 0.56, y: 0.22 + breath, z: 0.05, visibility: 0.98 };
    lms[POSE_LANDMARKS.MOUTH_LEFT] = { x: 0.48, y: 0.26 + breath, z: -0.01, visibility: 0.98 };
    lms[POSE_LANDMARKS.MOUTH_RIGHT] = { x: 0.52, y: 0.26 + breath, z: -0.01, visibility: 0.98 };

    // Shoulders
    lms[POSE_LANDMARKS.LEFT_SHOULDER] = { x: 0.38, y: 0.35 + breath, z: 0, visibility: 0.99 };
    lms[POSE_LANDMARKS.RIGHT_SHOULDER] = { x: 0.62, y: 0.35 + breath, z: 0, visibility: 0.99 };

    // Hips
    lms[POSE_LANDMARKS.LEFT_HIP] = { x: 0.42, y: 0.58, z: 0, visibility: 0.99 };
    lms[POSE_LANDMARKS.RIGHT_HIP] = { x: 0.58, y: 0.58, z: 0, visibility: 0.99 };

    // Default Guard Stance for arms
    let lw = { x: 0.44, y: 0.38 + breath, z: -0.2 };
    let rw = { x: 0.56, y: 0.38 + breath, z: -0.2 };
    let le = { x: 0.34, y: 0.46 + breath, z: -0.05 };
    let re = { x: 0.66, y: 0.46 + breath, z: -0.05 };

    if (overrideAction === 'LEFT_PUNCH') {
      lw = { x: 0.46, y: 0.32, z: -0.6 };
      le = { x: 0.4, y: 0.34, z: -0.3 };
    } else if (overrideAction === 'RIGHT_PUNCH') {
      rw = { x: 0.54, y: 0.32, z: -0.6 };
      re = { x: 0.6, y: 0.34, z: -0.3 };
    } else if (overrideAction === 'BLOCK') {
      lw = { x: 0.48, y: 0.24, z: -0.25 };
      rw = { x: 0.52, y: 0.24, z: -0.25 };
    }

    lms[POSE_LANDMARKS.LEFT_ELBOW] = { ...le, visibility: 0.99 };
    lms[POSE_LANDMARKS.RIGHT_ELBOW] = { ...re, visibility: 0.99 };
    lms[POSE_LANDMARKS.LEFT_WRIST] = { ...lw, visibility: 0.99 };
    lms[POSE_LANDMARKS.RIGHT_WRIST] = { ...rw, visibility: 0.99 };

    // Knees and feet
    lms[POSE_LANDMARKS.LEFT_KNEE] = { x: 0.43, y: 0.78, z: 0, visibility: 0.99 };
    lms[POSE_LANDMARKS.RIGHT_KNEE] = { x: 0.57, y: 0.78, z: 0, visibility: 0.99 };
    lms[POSE_LANDMARKS.LEFT_ANKLE] = { x: 0.42, y: 0.95, z: 0, visibility: 0.99 };
    lms[POSE_LANDMARKS.RIGHT_ANKLE] = { x: 0.58, y: 0.95, z: 0, visibility: 0.99 };

    return lms;
  }

  /**
   * Evaluates how well the player's body is framed for combat.
   * Seamlessly supports both Upper-Body / Half-Body Boxing (Desk Mode)
   * and Full-Body Combat (Kickboxing).
   */
  public evaluateBodyExposure(landmarks: Landmark[]): BodyExposureReport {
    if (!landmarks || landmarks.length < 33) {
      return {
        headVisible: false,
        shouldersVisible: false,
        wristsVisible: false,
        hipsVisible: false,
        kneesVisible: false,
        feetVisible: false,
        halfBodyExposed: false,
        fullBodyExposed: false,
        trackingMode: 'NO_BODY',
        exposureScore: 0,
        distance: 'TOO_FAR',
        horizontalAlignment: 'CENTERED',
        guidanceMessage: 'No player body detected',
        suggestedAction: 'Please step in front of your camera with good lighting',
      };
    }

    const nose = landmarks[POSE_LANDMARKS.NOSE];
    const leftShoulder = landmarks[POSE_LANDMARKS.LEFT_SHOULDER];
    const rightShoulder = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER];
    const leftWrist = landmarks[POSE_LANDMARKS.LEFT_WRIST];
    const rightWrist = landmarks[POSE_LANDMARKS.RIGHT_WRIST];
    const leftHip = landmarks[POSE_LANDMARKS.LEFT_HIP];
    const rightHip = landmarks[POSE_LANDMARKS.RIGHT_HIP];
    const leftKnee = landmarks[POSE_LANDMARKS.LEFT_KNEE];
    const rightKnee = landmarks[POSE_LANDMARKS.RIGHT_KNEE];
    const leftAnkle = landmarks[POSE_LANDMARKS.LEFT_ANKLE];
    const rightAnkle = landmarks[POSE_LANDMARKS.RIGHT_ANKLE];

    const isVis = (lm?: Landmark): boolean => Boolean(lm && ((lm.visibility ?? 1) > 0.38));

    const headVisible = isVis(nose);
    const shouldersVisible = isVis(leftShoulder) && isVis(rightShoulder);
    const wristsVisible = isVis(leftWrist) || isVis(rightWrist);
    const hipsVisible = isVis(leftHip) && isVis(rightHip);
    const kneesVisible = isVis(leftKnee) || isVis(rightKnee);
    const feetVisible = isVis(leftAnkle) || isVis(rightAnkle);

    // Core half-body check: head + shoulders + at least one wrist visible
    const halfBodyExposed = Boolean(headVisible && shouldersVisible && wristsVisible);
    const fullBodyExposed = Boolean(halfBodyExposed && hipsVisible && (kneesVisible || feetVisible));

    const trackingMode: 'HALF_BODY' | 'FULL_BODY' | 'NO_BODY' = fullBodyExposed
      ? 'FULL_BODY'
      : (halfBodyExposed || (headVisible && shouldersVisible))
        ? 'HALF_BODY'
        : 'NO_BODY';

    // In half-body boxing mode, full upper body framing gives 90-100% score
    let exposureScore = 0;
    if (fullBodyExposed) {
      exposureScore = 100;
    } else if (halfBodyExposed) {
      exposureScore = isVis(leftWrist) && isVis(rightWrist) ? 95 : 85;
    } else if (headVisible && shouldersVisible) {
      exposureScore = 60;
    } else if (headVisible) {
      exposureScore = 30;
    }

    // Distance & alignment checks
    let distance: 'TOO_CLOSE' | 'TOO_FAR' | 'GOOD' = 'GOOD';
    let horizontalAlignment: 'CENTERED' | 'MOVE_LEFT' | 'MOVE_RIGHT' = 'CENTERED';

    if (leftShoulder && rightShoulder) {
      const shoulderSpan = Math.abs(rightShoulder.x - leftShoulder.x);
      const centerX = (leftShoulder.x + rightShoulder.x) / 2;

      // Note: webcam is mirrored (transform: scaleX(-1))
      if (centerX < 0.36) {
        horizontalAlignment = 'MOVE_RIGHT';
      } else if (centerX > 0.64) {
        horizontalAlignment = 'MOVE_LEFT';
      }

      if (shoulderSpan > 0.54) {
        distance = 'TOO_CLOSE';
      } else if (shoulderSpan < 0.13) {
        distance = 'TOO_FAR';
      }
    }

    // Dynamic player guidance
    let guidanceMessage = 'Optimal fighter stance detected';
    let suggestedAction = 'Maintain guard position and throw punches';

    if (trackingMode === 'NO_BODY') {
      guidanceMessage = 'Step into camera frame';
      suggestedAction = 'Ensure your face and chest are lit and visible';
    } else if (distance === 'TOO_CLOSE') {
      guidanceMessage = 'Too close to camera';
      suggestedAction = 'Step back slightly to give your arms room to punch';
    } else if (distance === 'TOO_FAR') {
      guidanceMessage = 'Too far from camera';
      suggestedAction = 'Move closer to your webcam for better strike tracking';
    } else if (horizontalAlignment === 'MOVE_LEFT') {
      guidanceMessage = 'Shift Left ⬅️';
      suggestedAction = 'Move slightly left to center your fighter stance';
    } else if (horizontalAlignment === 'MOVE_RIGHT') {
      guidanceMessage = 'Shift Right ➡️';
      suggestedAction = 'Move slightly right to center your fighter stance';
    } else if (!wristsVisible) {
      guidanceMessage = 'Raise Fists to Guard 🥊';
      suggestedAction = 'Bring your hands up in front of your chest to start punching';
    } else if (trackingMode === 'HALF_BODY') {
      guidanceMessage = '🥊 Upper-Body Boxing Ready!';
      suggestedAction = 'Desk Mode: Jabs, Hooks & Guard Active!';
    } else {
      guidanceMessage = '🥋 Full-Body Combat Ready!';
      suggestedAction = 'Punches, Dodges & Kicks Active!';
    }

    return {
      headVisible,
      shouldersVisible,
      wristsVisible,
      hipsVisible,
      kneesVisible,
      feetVisible,
      halfBodyExposed,
      fullBodyExposed,
      trackingMode,
      exposureScore,
      distance,
      horizontalAlignment,
      guidanceMessage,
      suggestedAction,
    };
  }

  /**
   * Fast canvas rendering of the 33-point skeletal landmark mesh
   * with real-time targeting reticles and visual directions
   */
  public drawSkeleton(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    landmarks: Landmark[],
    activeAction?: string
  ): void {
    if (!landmarks || landmarks.length < 33) {
      ctx.clearRect(0, 0, width, height);
      return;
    }

    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);

    // 1. Skeletal Connecting Bones
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.85)';

    for (const [startIdx, endIdx] of POSE_CONNECTIONS) {
      const p1 = landmarks[startIdx];
      const p2 = landmarks[endIdx];

      if (p1 && p2 && (p1.visibility ?? 1) > 0.32 && (p2.visibility ?? 1) > 0.32) {
        ctx.beginPath();
        ctx.moveTo(p1.x * width, p1.y * height);
        ctx.lineTo(p2.x * width, p2.y * height);
        ctx.stroke();
      }
    }

    // 2. Joint Keypoints with Punch Reticles
    for (let i = 0; i < landmarks.length; i++) {
      const pt = landmarks[i];
      if (!pt || (pt.visibility ?? 1) < 0.32) continue;

      const px = pt.x * width;
      const py = pt.y * height;

      const isLeftWrist = i === POSE_LANDMARKS.LEFT_WRIST;
      const isRightWrist = i === POSE_LANDMARKS.RIGHT_WRIST;
      const isWrist = isLeftWrist || isRightWrist;
      const isHead = i === POSE_LANDMARKS.NOSE;

      if (isWrist) {
        // Glowing fist indicator
        const isPunching = Boolean(activeAction && (activeAction.includes('PUNCH') || activeAction.includes('HOOK')));
        const radius = isPunching ? 12 : 8;

        ctx.beginPath();
        ctx.arc(px, py, radius, 0, 2 * Math.PI);
        ctx.fillStyle = isPunching ? '#ff3b30' : '#ffaa00';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        // Pulsing strike ring
        ctx.beginPath();
        ctx.arc(px, py, radius + 4, 0, 2 * Math.PI);
        ctx.strokeStyle = isPunching ? 'rgba(255, 59, 48, 0.8)' : 'rgba(255, 170, 0, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (isHead) {
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, 2 * Math.PI);
        ctx.fillStyle = '#00f0ff';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#060812';
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#060812';
        ctx.stroke();
      }
    }

    ctx.restore();
  }
}

export const cameraPoseService = new CameraPoseService();
