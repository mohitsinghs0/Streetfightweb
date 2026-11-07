/**
 * Motion Debugger & Gesture Recording Studio (Section 40 & 41)
 */

import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Play, Square, Download, Sliders, Camera, Activity } from 'lucide-react';
import { cameraPoseService } from '../motion/pose/poseDetector';
import { GestureDetector } from '../motion/gestures/gestureDetector';
import { Landmark, PoseFrame, RecordedGestureFrame, GestureRecording } from '../types/pose';
import { calibrationManager } from '../motion/calibration/calibrationManager';

interface MotionDebuggerProps {
  onBackToTitle: () => void;
}

export const MotionDebugger: React.FC<MotionDebuggerProps> = ({ onBackToTitle }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const detectorRef = useRef<GestureDetector>(new GestureDetector());

  // Kinematic meters
  const [metrics, setMetrics] = useState({
    leftWristSpeed: 0,
    rightWristSpeed: 0,
    torsoDisplacementX: 0,
    torsoDisplacementY: 0,
    leftElbowAngle: 120,
    rightElbowAngle: 120,
    leftKneeAngle: 170,
    rightKneeAngle: 170,
  });

  const [detectedAction, setDetectedAction] = useState<string>('IDLE');
  const [confidence, setConfidence] = useState<number>(1.0);
  const [reason, setReason] = useState<string>('Neutral');

  // Gesture Recorder state (Section 41)
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordLabel, setRecordLabel] = useState<string>('PUNCH');
  const recordedFramesRef = useRef<RecordedGestureFrame[]>([]);
  const recordStartTimeRef = useRef<number>(0);
  const [recordedCount, setRecordedCount] = useState<number>(0);
  const [lastExportUrl, setLastExportUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function init() {
      await cameraPoseService.initialize();
      if (!active) return;
      if (videoRef.current) {
        await cameraPoseService.startCamera(videoRef.current);
      }
    }

    init();

    let frameId: number = 0;
    const loop = () => {
      if (!active) return;

      cameraPoseService.processFrame((landmarks: Landmark[], timestamp: number) => {
        if (!active) return;

        // Draw skeleton
        if (canvasRef.current) {
          const ctx = canvasRef.current.getContext('2d');
          if (ctx) {
            cameraPoseService.drawSkeleton(ctx, canvasRef.current.width, canvasRef.current.height, landmarks);
          }
        }

        const frame: PoseFrame | null = detectorRef.current.processRawLandmarks(landmarks, timestamp);
        if (frame) {
          const calib = calibrationManager.getCalibration();
          const result = detectorRef.current.detect(frame, calib);

          setDetectedAction(result.action);
          setConfidence(result.confidence);
          setReason(result.reason || 'Neutral');

          setMetrics({
            leftWristSpeed: Math.round(result.metrics.leftWristSpeed * 10) / 10,
            rightWristSpeed: Math.round(result.metrics.rightWristSpeed * 10) / 10,
            torsoDisplacementX: Math.round(result.metrics.torsoDisplacementX * 100) / 100,
            torsoDisplacementY: Math.round(result.metrics.torsoDisplacementY * 100) / 100,
            leftElbowAngle: Math.round(result.metrics.leftElbowAngle),
            rightElbowAngle: Math.round(result.metrics.rightElbowAngle),
            leftKneeAngle: Math.round(frame.leftKneeAngle),
            rightKneeAngle: Math.round(frame.rightKneeAngle),
          });

          // If recording is active, append frame
          if (isRecording) {
            recordedFramesRef.current.push({
              timestamp: timestamp - recordStartTimeRef.current,
              landmarks,
              detectedGesture: result.action,
            });
            setRecordedCount(recordedFramesRef.current.length);
          }
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
  }, [isRecording]);

  const startRecording = () => {
    recordedFramesRef.current = [];
    recordStartTimeRef.current = Date.now();
    setIsRecording(true);
    setRecordedCount(0);
    setLastExportUrl(null);
  };

  const stopRecording = () => {
    setIsRecording(false);
    const duration = Date.now() - recordStartTimeRef.current;
    const recordingData: GestureRecording = {
      id: `rec_${Date.now()}`,
      label: recordLabel,
      recordedAt: new Date().toISOString(),
      frameCount: recordedFramesRef.current.length,
      durationMs: duration,
      frames: recordedFramesRef.current,
    };

    const blob = new Blob([JSON.stringify(recordingData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    setLastExportUrl(url);
  };

  return (
    <div className="min-h-screen bg-[#060812] text-white flex flex-col p-6 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-900 mb-6">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBackToTitle}
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-cyan-500/50 text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-lg font-black tracking-wider text-cyan-400 uppercase">
              MOTION DEBUGGER & GESTURE RECORDER
            </h1>
            <p className="text-xs text-slate-400 font-mono">
              Live joint angles, kinematic velocities, and landmark sequence logger
            </p>
          </div>
        </div>
      </div>

      {/* Main Grid: Camera Left, Kinematics Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
        {/* Left: Big Camera Skeleton View */}
        <div className="lg:col-span-7 flex flex-col">
          <div className="relative aspect-video bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 shadow-2xl flex items-center justify-center">
            <video
              ref={videoRef}
              className="w-full h-full object-cover transform -scale-x-100 opacity-60"
              playsInline
              muted
            />
            <canvas
              ref={canvasRef}
              width={640}
              height={360}
              className="absolute inset-0 w-full h-full pointer-events-none"
            />

            <div className="absolute top-4 left-4 bg-slate-950/80 px-3 py-1 rounded-lg border border-slate-800 text-xs font-mono text-cyan-400">
              SKELETON PROJECTION
            </div>

            {/* Gesture Overlay Ribbon */}
            <div className="absolute bottom-4 left-4 right-4 bg-slate-950/90 border border-cyan-500/40 p-3 rounded-xl flex items-center justify-between font-mono text-xs shadow-lg">
              <div className="flex items-center space-x-2">
                <span className="text-slate-400">ACTION:</span>
                <span className="text-cyan-300 font-bold text-sm uppercase">{detectedAction.replace('_', ' ')}</span>
              </div>
              <div className="text-slate-400">
                CONFIDENCE: <span className="text-emerald-400 font-bold">{Math.round(confidence * 100)}%</span>
              </div>
              <div className="text-slate-500 text-[11px] truncate max-w-[150px]">{reason}</div>
            </div>
          </div>
        </div>

        {/* Right: Kinematics Gauges & Gesture Recording Studio */}
        <div className="lg:col-span-5 flex flex-col space-y-4">
          {/* Kinematic Meters Card */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl font-mono text-xs">
            <div className="flex items-center space-x-2 text-cyan-400 font-bold mb-4 uppercase tracking-wider text-[11px]">
              <Activity className="w-4 h-4" />
              <span>LIVE KINEMATIC GAUGES</span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-slate-300">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <div className="text-[10px] text-slate-500 mb-1">LEFT WRIST VELOCITY</div>
                <div className="text-base font-bold text-cyan-400 tabular-nums">
                  {metrics.leftWristSpeed} <span className="text-xs text-slate-500">units/s</span>
                </div>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <div className="text-[10px] text-slate-500 mb-1">RIGHT WRIST VELOCITY</div>
                <div className="text-base font-bold text-rose-400 tabular-nums">
                  {metrics.rightWristSpeed} <span className="text-xs text-slate-500">units/s</span>
                </div>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <div className="text-[10px] text-slate-500 mb-1">TORSO LATERAL OFFSET</div>
                <div className="text-base font-bold text-amber-400 tabular-nums">
                  {metrics.torsoDisplacementX} <span className="text-xs text-slate-500">dx</span>
                </div>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <div className="text-[10px] text-slate-500 mb-1">TORSO VERTICAL OFFSET</div>
                <div className="text-base font-bold text-slate-200 tabular-nums">
                  {metrics.torsoDisplacementY} <span className="text-xs text-slate-500">dy</span>
                </div>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <div className="text-[10px] text-slate-500 mb-1">LEFT ELBOW ANGLE</div>
                <div className="text-base font-bold text-slate-200 tabular-nums">{metrics.leftElbowAngle}°</div>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <div className="text-[10px] text-slate-500 mb-1">RIGHT ELBOW ANGLE</div>
                <div className="text-base font-bold text-slate-200 tabular-nums">{metrics.rightElbowAngle}°</div>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <div className="text-[10px] text-slate-500 mb-1">LEFT KNEE ANGLE</div>
                <div className="text-base font-bold text-slate-200 tabular-nums">{metrics.leftKneeAngle}°</div>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <div className="text-[10px] text-slate-500 mb-1">RIGHT KNEE ANGLE</div>
                <div className="text-base font-bold text-slate-200 tabular-nums">{metrics.rightKneeAngle}°</div>
              </div>
            </div>
          </div>

          {/* Gesture Recording Tool (Section 41) */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl font-mono text-xs">
            <div className="flex items-center space-x-2 text-rose-400 font-bold mb-3 uppercase tracking-wider text-[11px]">
              <Sliders className="w-4 h-4" />
              <span>GESTURE RECORDING TOOL (JSON)</span>
            </div>

            <p className="text-slate-400 mb-4 leading-relaxed text-[11px]">
              Record local landmark sequences for tuning detectors. Raw video is never stored or uploaded.
            </p>

            <div className="flex items-center space-x-2 mb-4">
              <label className="text-slate-400 text-[11px]">LABEL:</label>
              {(['PUNCH', 'BLOCK', 'DODGE', 'KICK', 'IDLE'] as const).map((lbl) => (
                <button
                  key={lbl}
                  onClick={() => setRecordLabel(lbl)}
                  className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase transition-colors ${
                    recordLabel === lbl
                      ? 'bg-rose-500 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              {!isRecording ? (
                <button
                  onClick={startRecording}
                  className="flex-1 py-3 px-4 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-bold uppercase tracking-wider text-xs flex items-center justify-center space-x-2 transition-all cursor-pointer"
                >
                  <Play className="w-4 h-4" />
                  <span>Start Recording</span>
                </button>
              ) : (
                <button
                  onClick={stopRecording}
                  className="flex-1 py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold uppercase tracking-wider text-xs flex items-center justify-center space-x-2 transition-all cursor-pointer animate-pulse"
                >
                  <Square className="w-4 h-4" />
                  <span>Stop ({recordedCount} frames)</span>
                </button>
              )}

              {lastExportUrl && (
                <a
                  href={lastExportUrl}
                  download={`gesture_${recordLabel.toLowerCase()}_${Date.now()}.json`}
                  className="py-3 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold uppercase tracking-wider text-xs flex items-center justify-center space-x-1.5 transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Export JSON</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
