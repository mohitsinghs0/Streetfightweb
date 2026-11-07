/**
 * Motion Calibration Modal
 * Guides player to establish neutral torso center, shoulder width, and reach
 */

import React, { useState } from 'react';
import { Shield, Check, X, Camera } from 'lucide-react';
import { calibrationManager } from '../motion/calibration/calibrationManager';
import { sound } from '../game/audio/synthAudio';

interface CalibrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CalibrationModal: React.FC<CalibrationModalProps> = ({ isOpen, onClose }) => {
  const [step, setStep] = useState<number>(1);
  const [isCalibrating, setIsCalibrating] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleCaptureNeutral = () => {
    setIsCalibrating(true);
    sound.playRoundBell();
    setTimeout(() => {
      calibrationManager.finalizeCalibration();
      setIsCalibrating(false);
      setStep(3);
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-6 right-6 p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          aria-label="Close Calibration"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center space-x-3 mb-6">
          <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold uppercase tracking-wider text-white">BODY CALIBRATION</h2>
            <p className="text-xs text-slate-400 font-mono">Calibrate distance, shoulder width & neutral stance</p>
          </div>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 space-y-2">
              <div className="flex items-center space-x-2 text-cyan-400 font-bold">
                <Camera className="w-4 h-4" />
                <span>STEP 1: POSITIONING</span>
              </div>
              <p>1. Stand roughly 1.5 - 2.5 meters (5-8 ft) from your webcam.</p>
              <p>2. Ensure adequate room lighting on your upper body and arms.</p>
              <p>3. Make sure your head, shoulders, and hips are clearly visible in the frame.</p>
            </div>

            <button
              onClick={() => setStep(2)}
              className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold uppercase tracking-wider text-xs transition-colors cursor-pointer"
            >
              Next: Neutral Pose
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 space-y-2">
              <div className="flex items-center space-x-2 text-cyan-400 font-bold">
                <Shield className="w-4 h-4" />
                <span>STEP 2: NEUTRAL STANCE CAPTURE</span>
              </div>
              <p>Stand facing the camera in a relaxed martial arts ready stance.</p>
              <p>Click below and hold still for 1.5 seconds while your neutral baseline is recorded.</p>
            </div>

            <button
              onClick={handleCaptureNeutral}
              disabled={isCalibrating}
              className="w-full py-3.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-700 text-slate-950 font-bold uppercase tracking-wider text-xs transition-colors cursor-pointer flex items-center justify-center space-x-2"
            >
              {isCalibrating ? (
                <span>CALIBRATING BODY BASELINE...</span>
              ) : (
                <span>CAPTURE NEUTRAL STANCE</span>
              )}
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto mb-2">
              <Check className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-white uppercase tracking-wider">Calibration Complete!</h3>
            <p className="text-xs text-slate-400 font-mono">
              Neutral torso alignment and shoulder reach scale have been calibrated and saved to your device.
            </p>

            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold uppercase tracking-wider text-xs transition-colors cursor-pointer"
            >
              Done & Return to Dojo
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
