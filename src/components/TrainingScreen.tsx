/**
 * Training Screen & Motion Practice Lab (Section 59 MVP Requirement)
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Shield, Zap, ArrowLeft, Volume2, VolumeX, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { cameraPoseService, BodyExposureReport } from '../motion/pose/poseDetector';
import { GestureDetector } from '../motion/gestures/gestureDetector';
import { KeyboardInputProvider } from '../game/input/inputProvider';
import { CombatEngine } from '../game/combat/combatEngine';
import { ArenaRenderer } from '../game/rendering/arenaScene';
import { sound } from '../game/audio/synthAudio';
import { calibrationManager } from '../motion/calibration/calibrationManager';
import { ActionType, GameInput } from '../types/combat';
import { Landmark, PoseFrame } from '../types/pose';

interface TrainingScreenProps {
  onBackToTitle: () => void;
  onOpenCalibration: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
}

export const TrainingScreen: React.FC<TrainingScreenProps> = ({
  onBackToTitle,
  onOpenCalibration,
  isMuted,
  onToggleMute,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const threeMountRef = useRef<HTMLDivElement>(null);

  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraPermissionError, setCameraPermissionError] = useState<string | null>(null);
  const [showCameraPIP, setShowCameraPIP] = useState<boolean>(true);

  // Live telemetry & detection state
  const [detectedAction, setDetectedAction] = useState<ActionType>('IDLE');
  const detectedActionRef = useRef<ActionType>('IDLE');
  detectedActionRef.current = detectedAction;

  const [bodyReport, setBodyReport] = useState<BodyExposureReport>({
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
    distance: 'GOOD',
    horizontalAlignment: 'CENTERED',
    guidanceMessage: 'Camera starting...',
    suggestedAction: 'Raise fists to guard',
  });
  const [actionConfidence, setActionConfidence] = useState<number>(1.0);
  const [actionReason, setActionReason] = useState<string>('Standing neutral in guard');
  const [fps, setFps] = useState<number>(0);
  const [latencyMs, setLatencyMs] = useState<number>(0);
  const [isSimulatedPose, setIsSimulatedPose] = useState<boolean>(false);

  // Live kinematic metrics
  const [metrics, setMetrics] = useState({
    leftWristSpeed: 0,
    rightWristSpeed: 0,
    leftElbowAngle: 120,
    rightElbowAngle: 120,
    torsoDisplacementX: 0,
  });

  // Action checklist completion tracking
  const [completedGestures, setCompletedGestures] = useState<Record<string, boolean>>({
    LEFT_PUNCH: false,
    RIGHT_PUNCH: false,
    BLOCK: false,
    DODGE_LEFT: false,
    DODGE_RIGHT: false,
    KICK: false,
  });

  // Engine references
  const detectorRef = useRef<GestureDetector>(new GestureDetector());
  const combatEngineRef = useRef<CombatEngine>(new CombatEngine('HERO', 'PUNCHING DUMMY'));
  const arenaRendererRef = useRef<ArenaRenderer | null>(null);
  const keyboardProviderRef = useRef<KeyboardInputProvider | null>(null);

  // Initialize Three.js 3D viewport
  useEffect(() => {
    if (!threeMountRef.current) return;
    const renderer = new ArenaRenderer(threeMountRef.current);
    arenaRendererRef.current = renderer;

    const keyboard = new KeyboardInputProvider();
    keyboardProviderRef.current = keyboard;

    let lastTime = performance.now();
    let animId: number = 0;

    const loop = (currentTime: number) => {
      const dt = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      // Poll keyboard fallback events
      const kbEvents = keyboard.pollActionEvents();
      kbEvents.forEach((evt) => {
        handleActionTriggered(evt.action, evt.confidence, 'Keyboard key: ' + evt.action);
      });

      // Update simulation and render
      const simResult = combatEngineRef.current.update(dt);

      // Trigger hit sparks and audio when hits land on dummy
      simResult.hitEvents.forEach((hit) => {
        renderer.spawnHitSparks(hit.position, hit.wasBlocked);
        if (hit.wasBlocked) {
          sound.playBlockClank();
        } else {
          sound.playPunchHit(hit.damage > 12);
        }
      });

      renderer.render(simResult.player, simResult.opponent, dt);

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animId);
      keyboard.dispose();
      renderer.dispose();
    };
  }, []);

  // Handle action triggered either by camera pose or keyboard
  const handleActionTriggered = useCallback((action: ActionType, confidence: number, reason?: string) => {
    if (action === 'IDLE') return;

    setDetectedAction(action);
    setActionConfidence(confidence);
    setActionReason(reason || action);

    // Audio feedback for attack startup
    if (action === 'LEFT_PUNCH' || action === 'RIGHT_PUNCH' || action === 'LEFT_HOOK' || action === 'RIGHT_HOOK') {
      sound.playWhoosh(action.includes('LEFT') ? 340 : 280);
    } else if (action === 'BLOCK') {
      sound.playBlockClank();
    } else if (action === 'DODGE_LEFT' || action === 'DODGE_RIGHT') {
      sound.playDodge();
    } else if (action === 'KICK') {
      sound.playWhoosh(220);
    }

    // Input to combat engine
    combatEngineRef.current.handleInput('p1', {
      action,
      confidence,
      source: 'camera',
      timestamp: Date.now(),
    });

    // Mark gesture in checklist
    setCompletedGestures((prev) => ({
      ...prev,
      [action]: true,
    }));
  }, []);

  const handleActionTriggeredRef = useRef(handleActionTriggered);
  handleActionTriggeredRef.current = handleActionTriggered;

  const handleStartCamera = async () => {
    if (!videoRef.current) return;
    const ok = await cameraPoseService.startCamera(videoRef.current);
    setCameraActive(ok);
    if (ok) {
      setCameraPermissionError(null);
      setIsSimulatedPose(false);
      await cameraPoseService.initialize();
    }
  };

  // Camera initialization and pose detection loop
  useEffect(() => {
    let active = true;

    async function initCamera() {
      if (videoRef.current) {
        const ok = await cameraPoseService.startCamera(videoRef.current);
        if (active) {
          setCameraActive(ok);
          if (!ok) {
            setCameraPermissionError('Camera access required. Click button below to enable.');
            setIsSimulatedPose(true);
          } else {
            setCameraPermissionError(null);
            setIsSimulatedPose(false);
          }
        }
      }
      if (!active) return;

      await cameraPoseService.initialize();
    }

    initCamera();

    let frameId: number = 0;
    const processLoop = () => {
      if (!active) return;

      cameraPoseService.processFrame((landmarks: Landmark[], timestamp: number) => {
        if (!active) return;

        // Draw skeleton on 2D canvas overlay with punch reticle
        if (canvasRef.current) {
          const ctx = canvasRef.current.getContext('2d');
          if (ctx) {
            cameraPoseService.drawSkeleton(ctx, canvasRef.current.width, canvasRef.current.height, landmarks, detectedActionRef.current);
          }
        }

        if (landmarks && landmarks.length > 0) {
          const rep = cameraPoseService.evaluateBodyExposure(landmarks);
          setBodyReport(rep);
        }

        // Process landmarks through temporal filter and gesture detector
        const frame: PoseFrame | null = detectorRef.current.processRawLandmarks(landmarks, timestamp);
        if (frame) {
          const calib = calibrationManager.getCalibration();
          const result = detectorRef.current.detect(frame, calib);

          if (result.action !== 'IDLE') {
            handleActionTriggeredRef.current(result.action, result.confidence, result.reason);
          } else {
            setDetectedAction('IDLE');
          }

          setMetrics({
            leftWristSpeed: Math.round(result.metrics.leftWristSpeed * 10) / 10,
            rightWristSpeed: Math.round(result.metrics.rightWristSpeed * 10) / 10,
            leftElbowAngle: Math.round(result.metrics.leftElbowAngle),
            rightElbowAngle: Math.round(result.metrics.rightElbowAngle),
            torsoDisplacementX: Math.round(result.metrics.torsoDisplacementX * 100) / 100,
          });
        }

        const telem = cameraPoseService.getTelemetry();
        setFps(telem.fps);
        setLatencyMs(telem.latencyMs);
        setIsSimulatedPose(telem.isSimulated);
      });

      frameId = requestAnimationFrame(processLoop);
    };

    frameId = requestAnimationFrame(processLoop);

    return () => {
      active = false;
      cancelAnimationFrame(frameId);
      cameraPoseService.stop();
    };
  }, []);

  // Synthetic action injection for quick testing
  const triggerSyntheticAction = (action: ActionType) => {
    handleActionTriggered(action, 0.95, `Manual test trigger: ${action}`);
  };

  return (
    <div className="relative w-full h-full min-h-screen bg-[#060812] text-white flex flex-col select-none overflow-hidden font-sans">
      {/* 3D Full-Bleed Viewport */}
      <div ref={threeMountRef} className="absolute inset-0 w-full h-full z-0" />

      {/* Top Header Overlay */}
      <header className="relative z-10 flex items-center justify-between p-4 sm:p-6 bg-gradient-to-b from-[#060812]/90 to-transparent">
        <div className="flex items-center space-x-4">
          <button
            onClick={onBackToTitle}
            className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-slate-900/80 border border-slate-800 hover:border-cyan-500/50 text-slate-300 hover:text-white transition-colors text-xs font-mono uppercase tracking-wider cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Title</span>
          </button>

          <div>
            <h1 className="text-base sm:text-lg font-black tracking-wider text-cyan-400 uppercase">
              TRAINING LAB & MOTION LAB
            </h1>
            <p className="text-xs text-slate-400 font-mono">
              Strike, block, or dodge in front of your camera to test detection
            </p>
          </div>
        </div>

        {/* Status Badges & Controls */}
        <div className="flex items-center space-x-3">
          <div className="hidden sm:flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 text-xs font-mono">
            <span className="text-slate-400">FPS:</span>
            <span className="text-cyan-400 font-bold tabular-nums">{fps || 60}</span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">LATENCY:</span>
            <span className="text-emerald-400 font-bold tabular-nums">{latencyMs || 8} ms</span>
          </div>

          <button
            onClick={onToggleMute}
            className="p-2 rounded-lg bg-slate-900/80 border border-slate-800 hover:border-cyan-500/50 text-slate-300 hover:text-white transition-colors cursor-pointer"
            aria-label={isMuted ? 'Unmute Audio' : 'Mute Audio'}
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-cyan-400" />}
          </button>
        </div>
      </header>

      {/* Main Playfield: Floating Telemetry HUD */}
      <div className="relative z-10 flex-1 flex flex-col justify-between p-4 sm:p-6 pointer-events-none">
        {/* Active Detected Gesture Banner (Center Top) */}
        <div className="self-center flex flex-col items-center">
          <div className="px-6 py-2.5 rounded-2xl bg-slate-950/85 border border-cyan-500/50 shadow-[0_0_20px_rgba(0,240,255,0.25)] flex items-center space-x-3">
            <span className="text-xs uppercase tracking-widest text-slate-400 font-mono">DETECTED:</span>
            <span className="text-base sm:text-xl font-black tracking-wider text-cyan-300 uppercase">
              {detectedAction.replace('_', ' ')}
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 font-mono">
              {Math.round(actionConfidence * 100)}%
            </span>
          </div>
          <span className="text-xs text-slate-400 font-mono mt-1 drop-shadow">{actionReason}</span>
        </div>

        {/* Bottom Section: Camera PIP + Gestures Checklist + Kinematics Bar */}
        <div className="w-full flex flex-col lg:flex-row items-end justify-between gap-4 pointer-events-auto">
          {/* Left: Camera PIP with Neon Skeleton Overlay */}
          <div className="relative flex flex-col items-start w-full sm:w-auto">
            <div className="flex items-center justify-between w-full max-w-[288px] mb-1.5 px-0.5">
              <div className="flex items-center space-x-1.5 text-xs font-mono text-cyan-400 truncate">
                <Camera className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">CAMERA FEED</span>
                {isSimulatedPose && (
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0 font-bold">
                    SYNTHETIC
                  </span>
                )}
              </div>

              <button
                onClick={() => setShowCameraPIP(!showCameraPIP)}
                className="text-xs text-slate-400 hover:text-white font-mono flex items-center space-x-1 cursor-pointer shrink-0 ml-2"
              >
                {showCameraPIP ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{showCameraPIP ? 'Hide' : 'Show'}</span>
              </button>
            </div>

            {showCameraPIP && (
              <div className="relative w-64 h-48 sm:w-72 sm:h-52 bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-2xl">
                <video
                  ref={videoRef}
                  className="absolute inset-0 w-full h-full object-cover block z-0"
                  style={{ transform: 'scaleX(-1)' }}
                  autoPlay
                  playsInline
                  muted
                  onLoadedMetadata={(e) => {
                    e.currentTarget.play().catch(() => {});
                  }}
                />
                <canvas
                  ref={canvasRef}
                  width={320}
                  height={240}
                  className="absolute inset-0 w-full h-full pointer-events-none z-10"
                />

                {/* On-screen Mode & Direction HUD inside Camera PIP */}
                {cameraActive && (
                  <>
                    <div className="absolute top-2 left-2 right-2 flex items-center justify-between text-[9px] font-mono pointer-events-none z-20">
                      <span className="px-2 py-0.5 rounded bg-cyan-950/90 text-cyan-300 border border-cyan-700/60 font-bold shadow">
                        {bodyReport.trackingMode === 'FULL_BODY' ? '🥋 FULL-BODY' : '🥊 UPPER-BODY BOXING'}
                      </span>
                      {detectedAction !== 'IDLE' && (
                        <span className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 font-black animate-pulse shadow">
                          {detectedAction} 💥
                        </span>
                      )}
                    </div>

                    {bodyReport.horizontalAlignment === 'MOVE_LEFT' && (
                      <div className="absolute left-2 top-1/2 -translate-y-1/2 bg-cyan-950/95 border border-cyan-400 px-2 py-1 rounded text-[10px] font-black text-cyan-300 animate-pulse pointer-events-none z-20 shadow-lg">
                        ⬅️ Shift Left
                      </div>
                    )}
                    {bodyReport.horizontalAlignment === 'MOVE_RIGHT' && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 bg-cyan-950/95 border border-cyan-400 px-2 py-1 rounded text-[10px] font-black text-cyan-300 animate-pulse pointer-events-none z-20 shadow-lg">
                        Shift Right ➡️
                      </div>
                    )}

                    <div className="absolute bottom-2 left-2 right-2 bg-slate-950/90 border border-slate-800/90 px-2 py-1 rounded-lg text-[10px] font-mono flex items-center justify-between pointer-events-none z-20">
                      <span className="text-white font-bold truncate">{bodyReport.guidanceMessage}</span>
                      <span className="text-cyan-400 font-bold text-[9px] shrink-0 ml-1">{bodyReport.exposureScore}%</span>
                    </div>
                  </>
                )}

                {!cameraActive && (
                  <div className="absolute inset-0 bg-slate-950/90 p-4 flex flex-col items-center justify-center text-center">
                    <Camera className="w-6 h-6 text-cyan-400 mb-2 animate-pulse" />
                    <span className="text-xs text-white font-bold mb-1">Webcam Not Started</span>
                    <span className="text-[10px] text-slate-400 mb-3 max-w-[200px]">
                      Enable camera to track real punches & kicks
                    </span>
                    <button
                      onClick={handleStartCamera}
                      className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold uppercase tracking-wider cursor-pointer shadow"
                    >
                      Enable Camera
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Center: Live Kinematics Readout */}
          <div className="flex-1 max-w-md w-full bg-slate-950/85 border border-slate-800/90 rounded-xl p-3.5 shadow-xl font-mono text-xs">
            <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-2 font-bold flex items-center justify-between">
              <span>REAL-TIME KINEMATICS</span>
              <span className="text-cyan-400 text-[10px]">LOCAL POSE FRAME</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-slate-300">
              <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                <div className="text-[10px] text-slate-500">L WRIST VELOCITY</div>
                <div className="text-cyan-400 font-bold tabular-nums text-sm">
                  {metrics.leftWristSpeed} <span className="text-[10px] text-slate-500">units/s</span>
                </div>
              </div>

              <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                <div className="text-[10px] text-slate-500">R WRIST VELOCITY</div>
                <div className="text-rose-400 font-bold tabular-nums text-sm">
                  {metrics.rightWristSpeed} <span className="text-[10px] text-slate-500">units/s</span>
                </div>
              </div>

              <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                <div className="text-[10px] text-slate-500">L ELBOW FLEXION</div>
                <div className="text-slate-200 font-bold tabular-nums text-sm">{metrics.leftElbowAngle}°</div>
              </div>

              <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                <div className="text-[10px] text-slate-500">R ELBOW FLEXION</div>
                <div className="text-slate-200 font-bold tabular-nums text-sm">{metrics.rightElbowAngle}°</div>
              </div>
            </div>

            {/* Quick Test Simulator Row */}
            <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between">
              <span className="text-[10px] text-slate-500">QUICK TEST:</span>
              <div className="flex items-center space-x-1.5">
                {(['LEFT_PUNCH', 'RIGHT_PUNCH', 'BLOCK', 'DODGE_LEFT', 'KICK'] as ActionType[]).map((act) => (
                  <button
                    key={act}
                    onClick={() => triggerSyntheticAction(act)}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-cyan-500 hover:text-slate-950 text-[10px] font-bold uppercase transition-colors cursor-pointer"
                  >
                    {act.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Gesture Mastery Checklist */}
          <div className="w-full sm:w-64 bg-slate-950/85 border border-slate-800/90 rounded-xl p-3.5 shadow-xl font-mono text-xs">
            <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-2 font-bold flex items-center justify-between">
              <span>MOVE MASTERY</span>
              <span className="text-cyan-400 text-[10px]">
                {Object.values(completedGestures).filter(Boolean).length}/6
              </span>
            </div>

            <div className="space-y-1.5">
              {[
                { id: 'LEFT_PUNCH', label: 'Left Jab [J]', hint: 'Fast left wrist snap' },
                { id: 'RIGHT_PUNCH', label: 'Right Cross [K]', hint: 'Forward right strike' },
                { id: 'BLOCK', label: 'High Guard [Space]', hint: 'Both fists up to face' },
                { id: 'DODGE_LEFT', label: 'Dodge Left [A]', hint: 'Tilt torso left' },
                { id: 'DODGE_RIGHT', label: 'Dodge Right [D]', hint: 'Tilt torso right' },
                { id: 'KICK', label: 'Front Kick [L]', hint: 'Drive knee & foot up' },
              ].map((item) => {
                const done = completedGestures[item.id];
                return (
                  <div
                    key={item.id}
                    className={`flex items-center justify-between p-1.5 rounded transition-colors ${
                      done ? 'bg-cyan-950/40 text-cyan-300 border border-cyan-800/40' : 'bg-slate-900/60 text-slate-400'
                    }`}
                  >
                    <div>
                      <span className="font-bold">{item.label}</span>
                      <div className="text-[9px] text-slate-500">{item.hint}</div>
                    </div>
                    <span className="text-xs">{done ? '✓' : '○'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
