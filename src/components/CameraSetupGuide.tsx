/**
 * Step-by-Step Camera Setup, Permission & Full-Body Exposure Calibration Screen
 * Guides players to grant camera permission, calibrate body distance, and test gestures.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Camera,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Sparkles,
  Check,
  ArrowLeft,
  Video,
  ShieldAlert,
} from 'lucide-react';
import { cameraPoseService, BodyExposureReport } from '../motion/pose/poseDetector';
import { GestureDetector } from '../motion/gestures/gestureDetector';
import { calibrationManager } from '../motion/calibration/calibrationManager';
import { sound } from '../game/audio/synthAudio';
import { Landmark, PoseFrame } from '../types/pose';
import { ActionType } from '../types/combat';

interface CameraSetupGuideProps {
  onComplete: () => void;
  onBack: () => void;
}

export const CameraSetupGuide: React.FC<CameraSetupGuideProps> = ({ onComplete, onBack }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<GestureDetector>(new GestureDetector());

  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStartingCamera, setIsStartingCamera] = useState<boolean>(false);

  const [exposure, setExposure] = useState<BodyExposureReport>({
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
    guidanceMessage: 'Camera permission required to start',
    suggestedAction: 'Click "Start Camera & Grant Permission" below',
  });

  const [testMoves, setTestMoves] = useState({
    punch: false,
    block: false,
    dodge: false,
  });

  const [isCalibrated, setIsCalibrated] = useState<boolean>(false);
  const [activeGesture, setActiveGesture] = useState<string>('IDLE');

  const handleDetectedAction = useCallback((act: ActionType) => {
    setActiveGesture(act);
    if (act.includes('PUNCH') || act.includes('HOOK')) {
      setTestMoves((prev) => ({ ...prev, punch: true }));
      sound.playWhoosh(300);
    } else if (act === 'BLOCK') {
      setTestMoves((prev) => ({ ...prev, block: true }));
      sound.playBlockClank();
    } else if (act.includes('DODGE')) {
      setTestMoves((prev) => ({ ...prev, dodge: true }));
      sound.playDodge();
    }
  }, []);

  const isCameraActiveRef = useRef<boolean>(false);
  isCameraActiveRef.current = isCameraActive;

  const handleDetectedActionRef = useRef(handleDetectedAction);
  handleDetectedActionRef.current = handleDetectedAction;

  // Request camera via direct user action
  const handleStartCamera = async () => {
    if (!videoRef.current) return;
    setIsStartingCamera(true);
    setCameraError(null);

    try {
      const ok = await cameraPoseService.startCamera(videoRef.current);
      setIsCameraActive(ok);
      if (ok) {
        sound.playRoundBell();
        setCameraError(null);
        // Load AI detector model in parallel
        await cameraPoseService.initialize();
      } else {
        const err = cameraPoseService.getCameraErrorCode();
        setCameraError(err || 'PERMISSION_DENIED');
      }
    } catch (e: any) {
      setCameraError('PERMISSION_DENIED');
    } finally {
      setIsStartingCamera(false);
    }
  };

  // Attempt auto-start on mount (browsers may allow if permission was previously granted)
  useEffect(() => {
    let active = true;

    async function tryAutoStart() {
      if (videoRef.current) {
        const ok = await cameraPoseService.startCamera(videoRef.current);
        if (active && ok) {
          setIsCameraActive(true);
          await cameraPoseService.initialize();
        }
      }
    }

    tryAutoStart();

    let frameId: number = 0;
    const loop = () => {
      if (!active) return;

      cameraPoseService.processFrame((landmarks: Landmark[], timestamp: number) => {
        if (!active) return;

        // Draw skeleton overlay with active fist pulse
        if (canvasRef.current) {
          const ctx = canvasRef.current.getContext('2d');
          if (ctx) {
            cameraPoseService.drawSkeleton(ctx, canvasRef.current.width, canvasRef.current.height, landmarks, activeGesture);
          }
        }

        // Evaluate real body exposure (supports both Upper-Body Boxing & Full-Body)
        if (landmarks && landmarks.length > 0) {
          const rep = cameraPoseService.evaluateBodyExposure(landmarks);
          setExposure(rep);

          // Feed to gesture detector
          const frame: PoseFrame | null = detectorRef.current.processRawLandmarks(landmarks, timestamp);
          if (frame) {
            calibrationManager.addSample(frame);
            const res = detectorRef.current.detect(frame, calibrationManager.getCalibration());
            if (res.action !== 'IDLE') {
              handleDetectedActionRef.current(res.action);
            }
          }
        } else {
          const isCamLive = isCameraActiveRef.current || cameraPoseService.isCameraRunning();
          const isAiLoading = cameraPoseService.isAiModelLoading();
          setExposure((prev) => ({
            ...prev,
            exposureScore: 0,
            halfBodyExposed: false,
            fullBodyExposed: false,
            trackingMode: 'NO_BODY',
            guidanceMessage: isCamLive
              ? (isAiLoading ? 'Loading AI Motion Tracker...' : 'Step in front of your camera')
              : 'Webcam permission needed',
            suggestedAction: isCamLive
              ? (isAiLoading ? 'Camera is LIVE. Loading body tracking model...' : 'Ensure your upper body & arms are visible')
              : 'Click "Start Camera" to enable tracking',
          }));
        }
      });

      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);

    return () => {
      active = false;
      cancelAnimationFrame(frameId);
      cameraPoseService.stop();
    };
  }, []); // Run ONCE on mount; state updates will NOT tear down active video stream!

  const handleConfirmCalibration = () => {
    calibrationManager.finalizeCalibration();
    setIsCalibrated(true);
    sound.playRoundBell();
    setTimeout(() => {
      onComplete();
    }, 400);
  };

  return (
    <div className="relative w-full h-full min-h-screen bg-[#060812] text-white flex flex-col p-4 sm:p-8 select-none font-sans justify-between overflow-y-auto">
      {/* Background radial glow */}
      <div className="absolute top-1/4 left-1/3 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-cyan-500/10 rounded-full blur-[140px] pointer-events-none" />

      {/* Top Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-900 z-10">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-cyan-500/50 text-slate-300 hover:text-white transition-colors cursor-pointer"
            aria-label="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-base sm:text-xl font-black tracking-wider text-cyan-400 uppercase">
              CAMERA SETUP & FULL-BODY TRACKING
            </h1>
            <p className="text-[10px] text-slate-400 font-mono">
              Position your webcam so your upper body and arms are visible for motion combat
            </p>
          </div>
        </div>

        <button
          onClick={handleConfirmCalibration}
          className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold uppercase tracking-wider text-xs flex items-center space-x-2 transition-all cursor-pointer shadow-[0_0_15px_rgba(0,240,255,0.4)]"
        >
          <span>Skip to Dojo</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Main Setup Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 items-start my-auto py-4 z-10">
        {/* Camera Feed Column */}
        <div className="lg:col-span-7 flex flex-col items-center">
          <div className="relative w-full max-w-xl aspect-[4/3] bg-slate-950 rounded-2xl overflow-hidden border-2 border-slate-800 shadow-2xl">
            {/* Real Webcam Video Stream */}
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

            {/* Skeletal Pose Canvas Overlay */}
            <canvas
              ref={canvasRef}
              width={640}
              height={480}
              className="absolute inset-0 w-full h-full pointer-events-none z-10"
            />

            {/* Over-Video Camera Activation Screen (If Camera Not Started or Blocked) */}
            {!isCameraActive && (
              <div className="absolute inset-0 z-30 bg-slate-950/95 flex flex-col items-center justify-center p-6 text-center">
                <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/40 text-cyan-400 flex items-center justify-center mb-4 shadow-[0_0_25px_rgba(0,240,255,0.25)]">
                  <Camera className="w-8 h-8 animate-pulse" />
                </div>
                <h3 className="text-xl font-black uppercase tracking-wider text-white mb-2">
                  ENABLE YOUR WEBCAM
                </h3>
                <p className="text-xs text-slate-400 font-mono mb-6 max-w-sm">
                  Click the button below to grant camera access. Your video stays strictly in your browser (100% private & local).
                </p>

                <button
                  onClick={handleStartCamera}
                  disabled={isStartingCamera}
                  className="px-6 py-4 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-400 hover:from-cyan-400 hover:to-cyan-300 disabled:bg-slate-800 text-slate-950 font-black uppercase tracking-wider text-xs flex items-center space-x-2 transition-all cursor-pointer shadow-[0_0_25px_rgba(0,240,255,0.45)]"
                >
                  <Video className="w-4 h-4" />
                  <span>{isStartingCamera ? 'OPENING CAMERA...' : 'START CAMERA & GRANT PERMISSION'}</span>
                </button>

                {cameraError && (
                  <div className="mt-4 p-4 rounded-xl bg-slate-900/95 border border-cyan-500/40 text-slate-200 text-xs font-mono text-left max-w-md animate-in fade-in">
                    <div className="flex items-center space-x-2 text-cyan-400 font-bold mb-3">
                      <ShieldAlert className="w-4 h-4 shrink-0 text-cyan-400" />
                      <span>HOW TO ACTIVATE WEBCAM ON MAC:</span>
                    </div>

                    <div className="space-y-2.5 text-[11px] leading-relaxed text-slate-300">
                      <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                        <strong className="text-cyan-300">Step 1: Reload Page (Important)</strong>
                        <div className="text-slate-400 mt-0.5">
                          Chrome me toggle ON karne ke baad browser ko page refresh chahiye hota hai.
                        </div>
                        <button
                          onClick={() => window.location.reload()}
                          className="mt-2 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold uppercase text-[10px] cursor-pointer flex items-center space-x-1.5"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>Reload Page (Cmd + R)</span>
                        </button>
                      </div>

                      <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                        <strong className="text-amber-300">Step 2: Mac System Settings Check</strong>
                        <div className="text-slate-400 mt-0.5">
                          Mac par <strong>System Settings ➔ Privacy & Security ➔ Camera</strong> kholo aur check karo ki <strong>Google Chrome</strong> ka toggle ON hai ya nahi.
                        </div>
                      </div>

                      <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                        <strong className="text-slate-300">Step 3: Other Apps Close Karein</strong>
                        <div className="text-slate-400 mt-0.5">
                          Agar WhatsApp, Zoom, Photobooth ya FaceTime camera use kar raha hai toh use band karein.
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Target Silhouette Frame (Adaptive Upper-Body & Full-Body) */}
            {isCameraActive && (
              <div
                className={`absolute inset-6 border-2 border-dashed rounded-2xl pointer-events-none transition-colors duration-300 z-10 ${
                  exposure.halfBodyExposed || exposure.fullBodyExposed
                    ? 'border-cyan-400/80 shadow-[0_0_25px_rgba(0,240,255,0.25)]'
                    : 'border-amber-400/60'
                }`}
              >
                <div className="absolute top-4 left-1/2 -translate-x-1/2 w-20 h-24 rounded-full border border-dashed border-cyan-400/40" />
                <div className="absolute top-28 left-1/4 right-1/4 h-0.5 border-t border-dashed border-cyan-400/40" />

                {/* Real-time on-screen alignment directions */}
                {exposure.horizontalAlignment === 'MOVE_LEFT' && (
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 bg-cyan-950/95 border-2 border-cyan-400 px-3 py-2 rounded-xl text-cyan-300 font-bold text-xs animate-bounce shadow-xl flex items-center space-x-1.5">
                    <span>⬅️ SHIFT LEFT</span>
                  </div>
                )}
                {exposure.horizontalAlignment === 'MOVE_RIGHT' && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 bg-cyan-950/95 border-2 border-cyan-400 px-3 py-2 rounded-xl text-cyan-300 font-bold text-xs animate-bounce shadow-xl flex items-center space-x-1.5">
                    <span>SHIFT RIGHT ➡️</span>
                  </div>
                )}

                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                  <div className="text-[11px] font-mono text-cyan-300 font-bold uppercase tracking-widest bg-slate-950/80 px-2 py-0.5 rounded border border-cyan-900/60">
                    {exposure.trackingMode === 'FULL_BODY'
                      ? '🥋 FULL-BODY COMBAT READY'
                      : exposure.halfBodyExposed
                        ? '🥊 UPPER-BODY BOXING READY'
                        : 'CENTER BODY HERE'}
                  </div>
                </div>
              </div>
            )}

            {/* Top Diagnostic Banner */}
            <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none z-20">
              <div className="flex items-center space-x-2">
                <div className="bg-slate-950/85 border border-slate-800 px-3 py-1.5 rounded-xl font-mono text-xs flex items-center space-x-2">
                  <Camera className="w-3.5 h-3.5 text-cyan-400" />
                  <span>EXPOSURE:</span>
                  <span className={`font-bold ${exposure.exposureScore >= 75 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {exposure.exposureScore}%
                  </span>
                </div>

                {isCameraActive && (
                  <div className="bg-cyan-950/90 border border-cyan-500/50 px-2.5 py-1 rounded-xl font-mono text-[11px] text-cyan-300 font-bold flex items-center space-x-1">
                    <span>{exposure.trackingMode === 'FULL_BODY' ? '🥋 FULL-BODY' : '🥊 UPPER-BODY (DESK)'}</span>
                  </div>
                )}
              </div>

              <div
                className={`px-3 py-1.5 rounded-xl font-mono text-xs font-bold border ${
                  isCameraActive
                    ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                    : 'bg-rose-950/80 border-rose-500/50 text-rose-300'
                }`}
              >
                {isCameraActive ? 'LIVE WEBCAM ACTIVE' : 'WEBCAM STANDBY'}
              </div>
            </div>

            {/* Bottom Real-Time Guidance Prompt */}
            {isCameraActive && (
              <div className="absolute bottom-3 left-3 right-3 bg-slate-950/90 border border-slate-800 p-3 rounded-xl font-mono text-xs flex items-center justify-between z-20">
                <div className="flex items-center space-x-2">
                  {exposure.halfBodyExposed || exposure.fullBodyExposed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  )}
                  <div>
                    <div className="font-bold text-white">{exposure.guidanceMessage}</div>
                    <div className="text-[11px] text-cyan-300">{exposure.suggestedAction}</div>
                  </div>
                </div>

                {activeGesture !== 'IDLE' && (
                  <span className="text-[10px] px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 font-black animate-pulse uppercase tracking-wider shadow">
                    {activeGesture} 💥
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Checklist & Calibration Panel */}
        <div className="lg:col-span-5 flex flex-col space-y-4">
          {/* Body Visibility Checklist (Upper-Body & Lower-Body) */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl font-mono text-xs">
            <div className="text-cyan-400 font-bold mb-3 uppercase tracking-wider text-[11px] flex items-center justify-between">
              <span>BODY EXPOSURE CHECKLIST</span>
              <span className="text-emerald-400 text-[10px] font-bold">
                {exposure.halfBodyExposed ? '✓ DESK BOXING READY' : 'POSITIONING...'}
              </span>
            </div>

            <div className="space-y-2">
              <div className="text-[10px] text-cyan-400/80 font-bold uppercase tracking-wider pt-1">
                Upper Body (Active for Punches & Guard):
              </div>
              {[
                { label: 'Head & Face Visibility', state: exposure.headVisible, tip: 'Keep head below top edge' },
                { label: 'Shoulders & Arms', state: exposure.shouldersVisible, tip: 'Arms must have room to swing' },
                { label: 'Wrists / Fists Guard', state: exposure.wristsVisible, tip: 'Bring both fists up to guard' },
              ].map((item, idx) => (
                <div
                  key={idx}
                  className={`flex items-center justify-between p-2 rounded-xl transition-colors ${
                    item.state ? 'bg-emerald-950/30 text-emerald-300 border border-emerald-800/40' : 'bg-slate-950/60 text-slate-400'
                  }`}
                >
                  <div>
                    <span className="font-bold">{item.label}</span>
                    <div className="text-[10px] text-slate-500">{item.tip}</div>
                  </div>
                  <span className="text-xs font-bold">{item.state ? '✓ READY' : '○'}</span>
                </div>
              ))}

              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider pt-2">
                Lower Body (Optional for Desk - Step back for kicks):
              </div>
              {[
                { label: 'Torso & Hip Alignment', state: exposure.hipsVisible, tip: 'Center hips inside frame' },
                { label: 'Knees & Leg Drive', state: exposure.kneesVisible, tip: 'Ensure knees are unblocked' },
                { label: 'Feet / Ground Stance', state: exposure.feetVisible, tip: 'Tilt camera down slightly if hidden' },
              ].map((item, idx) => (
                <div
                  key={idx + 3}
                  className={`flex items-center justify-between p-2 rounded-xl transition-colors ${
                    item.state ? 'bg-emerald-950/30 text-emerald-300 border border-emerald-800/40' : 'bg-slate-950/60 text-slate-500'
                  }`}
                >
                  <div>
                    <span className="font-bold">{item.label}</span>
                    <div className="text-[10px] text-slate-500">{item.tip}</div>
                  </div>
                  <span className="text-xs font-bold">{item.state ? '✓ READY' : '○ (DESK OK)'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Test Moves Card */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl font-mono text-xs">
            <div className="text-amber-400 font-bold mb-3 uppercase tracking-wider text-[11px] flex items-center space-x-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              <span>TEST YOUR MOVEMENTS</span>
            </div>
            <p className="text-[11px] text-slate-400 mb-3">
              Perform each gesture in front of your camera to verify real strike mirroring:
            </p>

            <div className="grid grid-cols-3 gap-2">
              {[
                { name: 'PUNCH', desc: 'Extend fist forward', done: testMoves.punch },
                { name: 'BLOCK', desc: 'Hands up to face', done: testMoves.block },
                { name: 'DODGE', desc: 'Tilt body sideways', done: testMoves.dodge },
              ].map((m, idx) => (
                <div
                  key={idx}
                  className={`p-2.5 rounded-xl text-center border transition-all ${
                    m.done
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_12px_rgba(0,240,255,0.2)]'
                      : 'bg-slate-950/80 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="text-[10px] text-slate-500 uppercase">MOVE {idx + 1}</div>
                  <div className="font-bold text-sm my-0.5">{m.name}</div>
                  <div className="text-[9px] text-slate-500">{m.desc}</div>
                  {m.done && <div className="text-[9px] text-cyan-400 font-bold mt-1">✓ VERIFIED</div>}
                </div>
              ))}
            </div>
          </div>

          {/* Confirm Button */}
          <button
            onClick={handleConfirmCalibration}
            className="w-full py-4 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-400 hover:from-cyan-400 hover:to-cyan-300 text-slate-950 font-black uppercase tracking-wider text-xs flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-[0_0_20px_rgba(0,240,255,0.35)]"
          >
            <span>LOCK CAMERA & ENTER DOJO</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
