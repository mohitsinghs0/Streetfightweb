/**
 * Title Screen & Arcade Game Shell Header
 */

import React from 'react';
import { Camera, Shield, Users, Sliders, Play, Volume2, VolumeX, Swords, Cpu } from 'lucide-react';
import { sound } from '../game/audio/synthAudio';

interface TitleScreenProps {
  onStartTraining: () => void;
  onStartBotBattle: () => void;
  onOpenMultiplayer: () => void;
  onOpenCalibration: () => void;
  onOpenDebugger: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({
  onStartTraining,
  onStartBotBattle,
  onOpenMultiplayer,
  onOpenCalibration,
  onOpenDebugger,
  isMuted,
  onToggleMute,
}) => {
  return (
    <div className="relative w-full h-full min-h-screen bg-[#060812] text-white flex flex-col justify-between p-6 sm:p-10 select-none overflow-hidden font-sans">
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[400px] h-[400px] bg-rose-500/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Top Bar: Specs and Sound */}
      <div className="flex items-center justify-between z-10">
        <div className="flex items-center space-x-3">
          <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#00f0ff]" />
          <span className="text-xs uppercase tracking-widest font-mono text-cyan-400">
            KINETIC COMBAT ENGINE v1.0
          </span>
        </div>

        <button
          onClick={onToggleMute}
          className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 hover:border-cyan-500/50 text-slate-300 hover:text-white transition-colors cursor-pointer"
          title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
          aria-label={isMuted ? 'Unmute Audio' : 'Mute Audio'}
        >
          {isMuted ? <VolumeX className="w-5 h-5 text-rose-400" /> : <Volume2 className="w-5 h-5 text-cyan-400" />}
        </button>
      </div>

      {/* Center Hero Lockup */}
      <div className="flex flex-col items-center justify-center my-auto z-10 text-center max-w-3xl mx-auto">
        {/* Bespoke SVG Title Lockup */}
        <div className="mb-3">
          <svg className="w-full max-w-[540px] h-auto drop-shadow-[0_0_25px_rgba(0,240,255,0.4)]" viewBox="0 0 540 85" fill="none">
            <text
              x="270"
              y="60"
              textAnchor="middle"
              className="font-black tracking-widest text-[52px]"
              fill="url(#titleGradient)"
              style={{
                fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                letterSpacing: '0.12em',
                fontWeight: 900,
              }}
            >
              KINETIC CLASH
            </text>
            <defs>
              <linearGradient id="titleGradient" x1="0" y1="0" x2="540" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#00F0FF" />
                <stop offset="50%" stopColor="#FFFFFF" />
                <stop offset="100%" stopColor="#FF0055" />
              </linearGradient>
            </defs>
          </svg>
          <div className="text-xs sm:text-sm uppercase tracking-[0.3em] font-mono text-cyan-300 font-semibold mt-1">
            BODY-AS-CONTROLLER 3D COMBAT
          </div>
        </div>

        <p className="text-slate-400 text-sm sm:text-base max-w-lg mb-8 leading-relaxed">
          Position your camera, calibrate full-body posture, and strike in real life. Your jabs, crosses, blocks, and dodges directly drive your virtual fighter.
        </p>

        {/* 3 Main Game Mode Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 w-full max-w-2xl mb-4">
          {/* 1. Camera Setup & Training */}
          <button
            data-start="true"
            onClick={() => {
              sound.playRoundBell();
              onStartTraining();
            }}
            className="p-4 rounded-2xl bg-cyan-500 hover:bg-cyan-400 active:scale-[0.98] text-slate-950 font-bold uppercase tracking-wider text-xs flex flex-col items-center justify-center space-y-2 shadow-[0_0_20px_rgba(0,240,255,0.4)] transition-all cursor-pointer group"
          >
            <div className="p-2.5 rounded-xl bg-slate-950/20 text-slate-950">
              <Camera className="w-5 h-5" />
            </div>
            <span className="text-sm font-black">Camera & Training</span>
            <span className="text-[10px] text-slate-900/80 font-mono normal-case">Setup camera & practice moves</span>
          </button>

          {/* 2. VS Bot Battle (Easy / Medium / Hard) */}
          <button
            onClick={() => {
              sound.playRoundBell();
              onStartBotBattle();
            }}
            className="p-4 rounded-2xl bg-slate-900/90 border border-slate-700 hover:border-amber-500/70 hover:bg-slate-800 text-white font-bold uppercase tracking-wider text-xs flex flex-col items-center justify-center space-y-2 transition-all cursor-pointer group"
          >
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 group-hover:scale-110 transition-transform">
              <Cpu className="w-5 h-5" />
            </div>
            <span className="text-sm font-black">VS Bot Arena</span>
            <span className="text-[10px] text-slate-400 font-mono normal-case">Easy, Medium, or Hard AI</span>
          </button>

          {/* 3. Online Multiplayer Matchmaking */}
          <button
            onClick={() => {
              sound.playRoundBell();
              onOpenMultiplayer();
            }}
            className="p-4 rounded-2xl bg-slate-900/90 border border-slate-700 hover:border-rose-500/70 hover:bg-slate-800 text-white font-bold uppercase tracking-wider text-xs flex flex-col items-center justify-center space-y-2 transition-all cursor-pointer group"
          >
            <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-400 group-hover:scale-110 transition-transform">
              <Swords className="w-5 h-5" />
            </div>
            <span className="text-sm font-black">Multiplayer Queue</span>
            <span className="text-[10px] text-slate-400 font-mono normal-case">Waiting room & 1v1 match</span>
          </button>
        </div>

        {/* Secondary Tool Shortcuts */}
        <div className="flex items-center space-x-6 mt-4 text-xs text-slate-400 font-mono">
          <button
            onClick={onOpenCalibration}
            className="hover:text-cyan-400 transition-colors flex items-center space-x-1.5 cursor-pointer"
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Recalibrate Neutral Stance</span>
          </button>
          <span>•</span>
          <button
            onClick={onOpenDebugger}
            className="hover:text-cyan-400 transition-colors flex items-center space-x-1.5 cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Motion Lab & Sequence Logger</span>
          </button>
        </div>
      </div>

      {/* Footer: Privacy & Control Hints */}
      <div className="flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 font-mono border-t border-slate-900 pt-4 z-10 gap-2">
        <div className="flex items-center space-x-2 text-emerald-400/90">
          <Shield className="w-3.5 h-3.5" />
          <span>Local Camera Processing · Video is never transmitted</span>
        </div>

        <div className="text-slate-400">
          Keyboard fallback: <span className="text-slate-200">WASD</span> Move · <span className="text-slate-200">J</span> Jab · <span className="text-slate-200">K</span> Cross · <span className="text-slate-200">L</span> Kick · <span className="text-slate-200">Space</span> Block
        </div>
      </div>
    </div>
  );
};
