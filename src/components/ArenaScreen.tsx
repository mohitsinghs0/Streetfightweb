/**
 * 1v1 Combat Arena Match Screen
 * Supports Configurable Bot Difficulties (Easy / Medium / Hard) & Real Multiplayer Opponents
 * Features:
 * - Real-time Host-authoritative combat state synchronization across network & tabs
 * - Camera motion pose detection with instant camera preview & graceful keyboard fallback
 * - On-screen quick test attack bar (ideal for dual-tab same-device testing)
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ArrowLeft, Volume2, VolumeX, Pause, Play, RefreshCw, Trophy, Skull, Cpu, Wifi, Zap } from 'lucide-react';
import { cameraPoseService } from '../motion/pose/poseDetector';
import { GestureDetector } from '../motion/gestures/gestureDetector';
import { KeyboardInputProvider } from '../game/input/inputProvider';
import { CombatEngine } from '../game/combat/combatEngine';
import { ArenaRenderer } from '../game/rendering/arenaScene';
import { sound } from '../game/audio/synthAudio';
import { calibrationManager } from '../motion/calibration/calibrationManager';
import { BotAI } from '../game/combat/botAI';
import { ActionPhase, ActionType, BotDifficulty, BOT_DIFFICULTIES, MultiplayerPlayer } from '../types/combat';
import { Landmark } from '../types/pose';
import { multiplayerRoomManager, MatchSyncState } from '../multiplayer/roomManager';

interface ArenaScreenProps {
  onBackToTitle: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
  botDifficulty?: BotDifficulty;
  multiplayerOpponent?: MultiplayerPlayer | null;
}

export const ArenaScreen: React.FC<ArenaScreenProps> = ({
  onBackToTitle,
  isMuted,
  onToggleMute,
  botDifficulty = 'MEDIUM',
  multiplayerOpponent = null,
}) => {
  const threeMountRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const isHost = multiplayerRoomManager.getIsHost();
  const [currentDifficulty, setCurrentDifficulty] = useState<BotDifficulty>(botDifficulty);
  const [showDifficultySelect, setShowDifficultySelect] = useState<boolean>(false);

  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isGameOver, setIsGameOver] = useState<boolean>(false);
  const [winner, setWinner] = useState<string | null>(null);

  // Fighter HUD states
  const [playerHp, setPlayerHp] = useState<number>(100);
  const [playerStamina, setPlayerStamina] = useState<number>(100);
  const [opponentHp, setOpponentHp] = useState<number>(100);
  const [opponentStamina, setOpponentStamina] = useState<number>(100);
  const [roundTime, setRoundTime] = useState<number>(60);
  const [combo, setCombo] = useState<number>(0);
  const [lastAction, setLastAction] = useState<ActionType>('IDLE');
  const [cameraActive, setCameraActive] = useState<boolean>(false);

  // End of match stats
  const [stats, setStats] = useState({ hitsLanded: 0, damageDealt: 0, clearTime: 0 });

  const opponentName = multiplayerOpponent
    ? multiplayerOpponent.name
    : BOT_DIFFICULTIES[currentDifficulty].name;

  // Engine references
  const combatEngineRef = useRef<CombatEngine>(new CombatEngine('HERO', opponentName));
  const arenaRendererRef = useRef<ArenaRenderer | null>(null);
  const detectorRef = useRef<GestureDetector>(new GestureDetector());
  const keyboardRef = useRef<KeyboardInputProvider | null>(null);
  const botAiRef = useRef<BotAI>(new BotAI(currentDifficulty));

  // Sync throttle timer
  const lastSyncSentRef = useRef<number>(0);

  // Handle local action (from camera or keyboard or on-screen buttons)
  const handlePlayerAction = useCallback((action: ActionType, confidence: number) => {
    if (action === 'IDLE') return;
    setLastAction(action);

    if (action.includes('PUNCH') || action.includes('HOOK')) {
      sound.playWhoosh(300);
    } else if (action === 'BLOCK') {
      sound.playBlockClank();
    } else if (action.includes('DODGE')) {
      sound.playDodge();
    } else if (action === 'KICK') {
      sound.playWhoosh(220);
    }

    const inputPayload = {
      action,
      confidence,
      source: 'camera' as const,
      timestamp: Date.now(),
    };

    if (multiplayerOpponent) {
      if (isHost) {
        // Host controls p1
        combatEngineRef.current.handleInput('p1', inputPayload);
      } else {
        // Guest controls p2
        combatEngineRef.current.handleInput('p2', inputPayload);
      }
      multiplayerRoomManager.sendAction(inputPayload);
    } else {
      // Single player vs Bot
      combatEngineRef.current.handleInput('p1', inputPayload);
    }
  }, [multiplayerOpponent, isHost]);

  // Mount 3D Scene and Game Loop
  useEffect(() => {
    if (!threeMountRef.current) return;
    const renderer = new ArenaRenderer(threeMountRef.current);
    arenaRendererRef.current = renderer;

    const keyboard = new KeyboardInputProvider();
    keyboardRef.current = keyboard;

    botAiRef.current.setDifficulty(currentDifficulty);

    // If in multiplayer mode:
    if (multiplayerOpponent) {
      if (isHost) {
        // Host listens to Guest's actions and feeds into p2
        multiplayerRoomManager.onPeerAction((action) => {
          combatEngineRef.current.handleInput('p2', action);
        });
      } else {
        // Guest listens to Host's actions and feeds into p1
        multiplayerRoomManager.onPeerAction((action) => {
          combatEngineRef.current.handleInput('p1', action);
        });

        // Guest listens to Host's authoritative state sync
        multiplayerRoomManager.onSyncState((sync: MatchSyncState) => {
          const p1 = combatEngineRef.current.getPlayer();
          const p2 = combatEngineRef.current.getOpponent();

          p1.hp = sync.p1Hp;
          p1.stamina = sync.p1Stamina;
          p1.position.x = sync.p1X;
          p1.currentAction = sync.p1Action;
          p1.actionPhase = sync.p1Phase as ActionPhase;

          p2.hp = sync.p2Hp;
          p2.stamina = sync.p2Stamina;
          p2.position.x = sync.p2X;
          p2.currentAction = sync.p2Action;
          p2.actionPhase = sync.p2Phase as ActionPhase;

          setPlayerHp(Math.round(sync.p1Hp));
          setPlayerStamina(Math.round(sync.p1Stamina));
          setOpponentHp(Math.round(sync.p2Hp));
          setOpponentStamina(Math.round(sync.p2Stamina));
          setRoundTime(Math.ceil(sync.roundTime));

          // Play hits announced by host
          if (sync.hits && sync.hits.length > 0) {
            sync.hits.forEach((h) => {
              renderer.spawnHitSparks({ x: h.defenderId === 'p2' ? sync.p2X : sync.p1X, y: 1.2, z: 0 }, h.wasBlocked);
              if (h.wasBlocked) {
                sound.playBlockClank();
              } else {
                sound.playPunchHit(h.damage > 12);
              }
            });
          }

          if (sync.isRoundOver && !isGameOver) {
            setIsGameOver(true);
            setWinner(sync.winnerId);
            sound.playKO();
          }
        });
      }
    }

    let lastTime = performance.now();
    let animId: number = 0;

    const gameLoop = (currentTime: number) => {
      const dt = Math.min((currentTime - lastTime) / 1000, 0.1);
      lastTime = currentTime;

      if (!isPaused) {
        // Poll keyboard
        const kbEvents = keyboard.pollActionEvents();
        kbEvents.forEach((evt) => {
          handlePlayerAction(evt.action, evt.confidence);
        });

        // AI opponent behavior (only when single player vs bot)
        if (!multiplayerOpponent && !combatEngineRef.current.isFinished()) {
          const p1 = combatEngineRef.current.getPlayer();
          const p2 = combatEngineRef.current.getOpponent();

          const botInput = botAiRef.current.update(dt, p2, p1);
          if (botInput) {
            combatEngineRef.current.handleInput('p2', botInput);
          }
        }

        // Advance simulation
        // (Host is authoritative in multiplayer, or single player)
        let res = combatEngineRef.current.update(dt);

        // Process hits locally
        if (!multiplayerOpponent || isHost) {
          res.hitEvents.forEach((hit) => {
            renderer.spawnHitSparks(hit.position, hit.wasBlocked);
            if (hit.wasBlocked) {
              sound.playBlockClank();
            } else {
              sound.playPunchHit(hit.damage > 12);
            }
          });

          // Update HUD
          setPlayerHp(Math.round(res.player.hp));
          setPlayerStamina(Math.round(res.player.stamina));
          setOpponentHp(Math.round(res.opponent.hp));
          setOpponentStamina(Math.round(res.opponent.stamina));
          setRoundTime(Math.ceil(res.roundTimeRemaining));
          setCombo(res.player.comboCount);

          // Broadcast authoritative state to Guest every 50ms
          if (multiplayerOpponent && isHost && currentTime - lastSyncSentRef.current > 50) {
            lastSyncSentRef.current = currentTime;
            multiplayerRoomManager.sendSyncState({
              p1Hp: res.player.hp,
              p1Stamina: res.player.stamina,
              p1X: res.player.position.x,
              p1Action: res.player.currentAction,
              p1Phase: res.player.actionPhase,
              p2Hp: res.opponent.hp,
              p2Stamina: res.opponent.stamina,
              p2X: res.opponent.position.x,
              p2Action: res.opponent.currentAction,
              p2Phase: res.opponent.actionPhase,
              roundTime: res.roundTimeRemaining,
              isRoundOver: res.isRoundOver,
              winnerId: res.winnerId,
              hits: res.hitEvents.map((h) => ({
                defenderId: h.defenderId,
                wasBlocked: h.wasBlocked,
                damage: h.damage,
              })),
            });
          }

          // Check Match completion
          if (res.isRoundOver && !isGameOver) {
            setIsGameOver(true);
            setWinner(res.winnerId);
            sound.playKO();
            setStats({
              hitsLanded: res.player.totalHitsLanded,
              damageDealt: res.player.totalDamageDealt,
              clearTime: Math.round(60 - res.roundTimeRemaining),
            });
          }
        }

        // Render 3D fighters
        const currentP1 = combatEngineRef.current.getPlayer();
        const currentP2 = combatEngineRef.current.getOpponent();
        renderer.render(currentP1, currentP2, dt);
      }

      animId = requestAnimationFrame(gameLoop);
    };

    animId = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animId);
      keyboard.dispose();
      renderer.dispose();
    };
  }, [isPaused, isGameOver, currentDifficulty, multiplayerOpponent, isHost, handlePlayerAction]);

  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const handlePlayerActionRef = useRef(handlePlayerAction);
  handlePlayerActionRef.current = handlePlayerAction;

  const lastActionRef = useRef<ActionType>('IDLE');
  lastActionRef.current = lastAction;

  // Camera feed connection: starts camera immediately!
  useEffect(() => {
    let active = true;

    async function initCam() {
      if (videoRef.current) {
        const ok = await cameraPoseService.startCamera(videoRef.current);
        if (active) {
          setCameraActive(ok);
        }
      }
      if (!active) return;
      await cameraPoseService.initialize();
    }

    initCam();

    let frameId: number = 0;
    const loop = () => {
      if (!active) return;

      cameraPoseService.processFrame((landmarks: Landmark[], timestamp: number) => {
        if (!active || isPausedRef.current) return;

        if (canvasRef.current) {
          const ctx = canvasRef.current.getContext('2d');
          if (ctx) {
            cameraPoseService.drawSkeleton(ctx, canvasRef.current.width, canvasRef.current.height, landmarks, lastActionRef.current);
          }
        }

        const frame = detectorRef.current.processRawLandmarks(landmarks, timestamp);
        if (frame) {
          const calib = calibrationManager.getCalibration();
          const result = detectorRef.current.detect(frame, calib);
          if (result.action !== 'IDLE') {
            handlePlayerActionRef.current(result.action, result.confidence);
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
  }, []);

  // Restart match handler
  const handleRestart = () => {
    combatEngineRef.current.reset();
    botAiRef.current.reset();
    setIsGameOver(false);
    setWinner(null);
    setPlayerHp(100);
    setOpponentHp(100);
    setRoundTime(60);
    setCombo(0);
    sound.playRoundBell();
  };

  const handleDifficultyChange = (diff: BotDifficulty) => {
    setCurrentDifficulty(diff);
    botAiRef.current.setDifficulty(diff);
    setShowDifficultySelect(false);
    handleRestart();
  };

  return (
    <div className="relative w-full h-full min-h-screen bg-[#060812] text-white flex flex-col select-none overflow-hidden font-sans">
      {/* 3D Viewport */}
      <div ref={threeMountRef} className="absolute inset-0 w-full h-full z-0" />

      {/* Top Combat HUD: HP Bars, Round Timer, Opponent HP & Controls */}
      <header className="relative z-10 flex flex-col p-4 sm:p-6 pointer-events-none w-full">
        <div className="flex items-center justify-between w-full max-w-6xl mx-auto gap-4">
          {/* Player 1 (Left Fighter) */}
          <div className="flex-1 flex flex-col items-start min-w-[120px]">
            <div className="flex items-center space-x-2 text-xs font-mono font-bold text-cyan-400 mb-1">
              <span>{multiplayerOpponent ? (isHost ? 'HERO [YOU - HOST]' : `${opponentName} [HOST]`) : 'HERO [YOU]'}</span>
              <span className="text-white tabular-nums">{playerHp} HP</span>
            </div>
            {/* HP Bar */}
            <div className="w-full h-4 sm:h-5 bg-slate-900 rounded-lg overflow-hidden border border-slate-800 p-0.5">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-cyan-300 rounded transition-all duration-100"
                style={{ width: `${Math.max(0, playerHp)}%` }}
              />
            </div>
            {/* Stamina Bar */}
            <div className="w-4/5 h-1.5 sm:h-2 bg-slate-900 rounded-full overflow-hidden mt-1 border border-slate-800">
              <div
                className="h-full bg-amber-400 rounded-full transition-all duration-75"
                style={{ width: `${Math.max(0, playerStamina)}%` }}
              />
            </div>
          </div>

          {/* Center Round Timer & Pause */}
          <div className="flex flex-col items-center px-2 sm:px-4 shrink-0">
            <div className="text-2xl sm:text-4xl font-black font-mono tracking-widest text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.4)] tabular-nums">
              {roundTime}
            </div>
            <span className="text-[10px] uppercase tracking-widest text-slate-400 font-mono">
              {multiplayerOpponent ? 'P2P MATCH' : 'ROUND 1'}
            </span>
          </div>

          {/* Player 2 (Right Fighter) */}
          <div className="flex-1 flex flex-col items-end min-w-[120px]">
            <div className="flex items-center space-x-2 text-xs font-mono font-bold text-rose-400 mb-1">
              <span className="text-white tabular-nums">{opponentHp} HP</span>
              <span className="truncate max-w-[140px] sm:max-w-none">
                {multiplayerOpponent ? (isHost ? `${opponentName} [GUEST]` : 'HERO [YOU - GUEST]') : opponentName}
              </span>
            </div>
            {/* HP Bar */}
            <div className="w-full h-4 sm:h-5 bg-slate-900 rounded-lg overflow-hidden border border-slate-800 p-0.5">
              <div
                className="h-full bg-gradient-to-l from-rose-500 to-amber-500 rounded transition-all duration-100 ml-auto"
                style={{ width: `${Math.max(0, opponentHp)}%` }}
              />
            </div>
            {/* Stamina Bar */}
            <div className="w-4/5 h-1.5 sm:h-2 bg-slate-900 rounded-full overflow-hidden mt-1 border border-slate-800">
              <div
                className="h-full bg-amber-400 rounded-full transition-all duration-75 ml-auto"
                style={{ width: `${Math.max(0, opponentStamina)}%` }}
              />
            </div>
          </div>

          {/* Utility Buttons: Integrated into header */}
          <div className="flex items-center space-x-1.5 shrink-0 pointer-events-auto pl-2">
            {!multiplayerOpponent && (
              <button
                onClick={() => setShowDifficultySelect(true)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 hover:border-cyan-500/50 text-[11px] font-mono font-bold text-amber-400 flex items-center space-x-1 cursor-pointer"
                title="Change Bot Difficulty"
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>{currentDifficulty}</span>
              </button>
            )}

            {multiplayerOpponent && (
              <div className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 text-[10px] font-mono text-emerald-400">
                <Wifi className="w-3 h-3" />
                <span>SYNCED</span>
              </div>
            )}

            <button
              onClick={() => setIsPaused(!isPaused)}
              className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 hover:border-cyan-500/50 text-slate-300 hover:text-white transition-colors cursor-pointer"
              title={isPaused ? 'Resume' : 'Pause'}
              aria-label={isPaused ? 'Resume' : 'Pause'}
            >
              {isPaused ? <Play className="w-4 h-4 text-emerald-400" /> : <Pause className="w-4 h-4 text-cyan-400" />}
            </button>

            <button
              onClick={onToggleMute}
              className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 hover:border-cyan-500/50 text-slate-300 hover:text-white transition-colors cursor-pointer"
              aria-label={isMuted ? 'Unmute Audio' : 'Mute Audio'}
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-cyan-400" />}
            </button>

            <button
              onClick={onBackToTitle}
              className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 hover:border-cyan-500/50 text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="Quit to Menu"
              aria-label="Quit to Menu"
            >
              <ArrowLeft className="w-4 h-4 text-slate-300" />
            </button>
          </div>
        </div>

        {/* Dynamic Combo Counter */}
        {combo > 1 && (
          <div className="self-start mt-4 ml-4 animate-bounce">
            <div className="text-xl sm:text-2xl font-black text-amber-400 tracking-wider drop-shadow-[0_0_12px_#ffaa00]">
              COMBO x{combo}!
            </div>
          </div>
        )}
      </header>

      {/* Floating Camera Preview PIP (Bottom Left) */}
      <div className="absolute bottom-16 sm:bottom-6 left-4 sm:left-6 z-10 w-44 h-32 sm:w-48 sm:h-36 bg-slate-950/90 rounded-xl overflow-hidden border border-slate-800 shadow-xl pointer-events-auto">
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

        {!cameraActive && (
          <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-2 text-center">
            <span className="text-[10px] text-slate-300 font-mono mb-1.5">Camera Standby</span>
            <button
              onClick={async () => {
                if (videoRef.current) {
                  const ok = await cameraPoseService.startCamera(videoRef.current);
                  setCameraActive(ok);
                  if (ok) await cameraPoseService.initialize();
                }
              }}
              className="px-2 py-1 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-[10px] font-bold uppercase font-mono cursor-pointer"
            >
              Start Camera
            </button>
          </div>
        )}

        {/* Top PIP Mode Badge & Strike Alert */}
        <div className="absolute top-1 left-2 right-2 flex items-center justify-between text-[8px] font-mono pointer-events-none z-20">
          <span className="px-1.5 py-0.5 rounded bg-cyan-950/90 text-cyan-300 border border-cyan-800 font-bold">
            🥊 BOXING READY
          </span>
          {lastAction !== 'IDLE' && (
            <span className="px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 font-black animate-pulse shadow">
              {lastAction} 💥
            </span>
          )}
        </div>

        <div className="absolute bottom-1 left-2 right-2 flex items-center justify-between text-[9px] font-mono text-cyan-400/80 bg-slate-950/80 px-1.5 py-0.5 rounded z-20">
          <span>{cameraActive ? 'CAMERA LIVE' : 'KEYS ACTIVE'}</span>
          <span>{lastAction !== 'IDLE' ? lastAction : 'READY'}</span>
        </div>
      </div>

      {/* On-Screen Quick Strike Bar (Center Bottom) */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 pointer-events-auto flex items-center space-x-1 sm:space-x-2 bg-slate-950/85 border border-slate-800 px-3 py-2 rounded-2xl shadow-2xl font-mono text-xs max-w-full overflow-x-auto">
        <span className="text-[10px] text-slate-500 hidden md:inline mr-1">ACTION TEST:</span>
        {[
          { label: 'JAB [J]', action: 'LEFT_PUNCH' as ActionType },
          { label: 'CROSS [K]', action: 'RIGHT_PUNCH' as ActionType },
          { label: 'KICK [L]', action: 'KICK' as ActionType },
          { label: 'BLOCK [Space]', action: 'BLOCK' as ActionType },
          { label: 'DODGE L [A]', action: 'DODGE_LEFT' as ActionType },
          { label: 'DODGE R [D]', action: 'DODGE_RIGHT' as ActionType },
        ].map((btn) => (
          <button
            key={btn.action}
            onClick={() => handlePlayerAction(btn.action, 0.95)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-cyan-500 hover:text-slate-950 border border-slate-800 hover:border-cyan-400 text-slate-300 font-bold text-[10px] sm:text-xs transition-colors cursor-pointer shrink-0"
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* Game Over Modal */}
      {isGameOver && (
        <div className="absolute inset-0 z-30 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 text-center shadow-2xl animate-in zoom-in-95 duration-200">
            {winner === 'p1' ? (
              <div>
                <div className="w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center mx-auto mb-4">
                  <Trophy className="w-8 h-8" />
                </div>
                <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-wider text-amber-400 mb-1">
                  {multiplayerOpponent ? (isHost ? 'YOU WIN!' : `${opponentName} WINS!`) : 'VICTORY!'}
                </h1>
                <p className="text-xs text-slate-400 font-mono mb-6">Fighter dominated the arena with flawless motion.</p>
              </div>
            ) : (
              <div>
                <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-rose-400 flex items-center justify-center mx-auto mb-4">
                  <Skull className="w-8 h-8" />
                </div>
                <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-wider text-rose-400 mb-1">
                  {multiplayerOpponent ? (isHost ? `${opponentName} WINS!` : 'YOU WIN!') : 'KNOCKED OUT!'}
                </h1>
                <p className="text-xs text-slate-400 font-mono mb-6">Guard collapsed under heavy pressure.</p>
              </div>
            )}

            {/* Performance Stats */}
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 font-mono text-xs mb-6 grid grid-cols-3 gap-2">
              <div>
                <div className="text-[10px] text-slate-500">HITS LANDED</div>
                <div className="text-base font-bold text-cyan-400">{stats.hitsLanded}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500">TOTAL DAMAGE</div>
                <div className="text-base font-bold text-rose-400">{stats.damageDealt}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500">TIME REMAINING</div>
                <div className="text-base font-bold text-emerald-400">{roundTime}s</div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleRestart}
                className="flex-1 py-3.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold uppercase tracking-wider text-xs flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-[0_0_20px_rgba(0,240,255,0.3)]"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Rematch</span>
              </button>
              <button
                onClick={onBackToTitle}
                className="px-6 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold uppercase tracking-wider text-xs transition-colors cursor-pointer"
              >
                Title
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Difficulty Select Modal */}
      {showDifficultySelect && (
        <div className="absolute inset-0 z-20 bg-slate-950/80 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center shadow-2xl">
            <h2 className="text-lg font-bold uppercase tracking-wider mb-4">Select Bot Difficulty</h2>
            <div className="space-y-2 mb-4">
              {(['EASY', 'MEDIUM', 'HARD'] as BotDifficulty[]).map((d) => (
                <button
                  key={d}
                  onClick={() => handleDifficultyChange(d)}
                  className={`w-full py-3 rounded-xl font-mono text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    currentDifficulty === d
                      ? 'bg-cyan-500 text-slate-950 shadow-[0_0_15px_rgba(0,240,255,0.4)]'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {BOT_DIFFICULTIES[d].name} ({d})
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowDifficultySelect(false)}
              className="text-xs text-slate-500 hover:text-slate-300 font-mono"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Pause Modal */}
      {isPaused && (
        <div className="absolute inset-0 z-20 bg-slate-950/80 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center shadow-2xl">
            <h2 className="text-xl font-bold uppercase tracking-wider mb-2">Match Paused</h2>
            <p className="text-xs text-slate-400 mb-6 font-mono">Catch your breath, fighter.</p>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => setIsPaused(false)}
                className="w-full py-3 rounded-xl bg-cyan-500 text-slate-950 font-bold uppercase text-xs"
              >
                Resume Match
              </button>
              <button
                onClick={handleRestart}
                className="w-full py-3 rounded-xl bg-slate-800 text-white font-bold uppercase text-xs"
              >
                Restart Round
              </button>
              <button
                onClick={onBackToTitle}
                className="w-full py-3 rounded-xl bg-slate-800/60 text-slate-400 font-bold uppercase text-xs"
              >
                Quit to Title
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
