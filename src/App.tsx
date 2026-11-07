/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { TitleScreen } from './components/TitleScreen';
import { CameraSetupGuide } from './components/CameraSetupGuide';
import { TrainingScreen } from './components/TrainingScreen';
import { ArenaScreen } from './components/ArenaScreen';
import { MultiplayerLobby } from './components/MultiplayerLobby';
import { MotionDebugger } from './components/MotionDebugger';
import { CalibrationModal } from './components/CalibrationModal';
import { sound } from './game/audio/synthAudio';
import { BotDifficulty, MultiplayerPlayer } from './types/combat';
import { multiplayerRoomManager } from './multiplayer/roomManager';

export type ScreenMode = 'title' | 'setup' | 'training' | 'arena' | 'multiplayer' | 'debugger';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ScreenMode>('title');
  const [isCalibrationOpen, setIsCalibrationOpen] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(sound.getMuted());
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>('MEDIUM');
  const [activeMultiplayerOpponent, setActiveMultiplayerOpponent] = useState<MultiplayerPlayer | null>(null);

  // Handle ?autostart=1 or direct mode params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1' || params.get('mode') === 'training') {
      setCurrentScreen('training');
      document.body.dataset.state = 'playing';
    } else if (params.get('mode') === 'setup') {
      setCurrentScreen('setup');
      document.body.dataset.state = 'playing';
    } else if (params.get('mode') === 'arena') {
      setCurrentScreen('arena');
      document.body.dataset.state = 'playing';
    } else if (params.get('mode') === 'multiplayer' || params.get('room')) {
      setCurrentScreen('multiplayer');
      document.body.dataset.state = 'playing';
    } else {
      document.body.dataset.state = 'title';
    }
  }, []);

  // Keyboard shortcuts for Title screen Start & Pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (currentScreen === 'title') {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          sound.playRoundBell();
          setCurrentScreen('setup');
          document.body.dataset.state = 'playing';
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentScreen]);

  const toggleMute = () => {
    const muted = sound.toggleMute();
    setIsMuted(muted);
  };

  const handleStartTrainingFlow = () => {
    setCurrentScreen('setup');
    document.body.dataset.state = 'playing';
  };

  const handleStartBotBattle = () => {
    setActiveMultiplayerOpponent(null);
    setCurrentScreen('arena');
    document.body.dataset.state = 'playing';
  };

  const handleOpenMultiplayer = () => {
    setCurrentScreen('multiplayer');
    document.body.dataset.state = 'playing';
  };

  const handleMultiplayerMatchStart = (opponent: MultiplayerPlayer) => {
    setActiveMultiplayerOpponent(opponent);
    setCurrentScreen('arena');
    document.body.dataset.state = 'playing';
  };

  const handleBackToTitle = () => {
    multiplayerRoomManager.leaveRoom();
    setActiveMultiplayerOpponent(null);
    setCurrentScreen('title');
    document.body.dataset.state = 'title';
  };

  return (
    <div className="w-full h-full min-h-screen bg-[#060812] text-white">
      {currentScreen === 'title' && (
        <TitleScreen
          onStartTraining={handleStartTrainingFlow}
          onStartBotBattle={handleStartBotBattle}
          onOpenMultiplayer={handleOpenMultiplayer}
          onOpenCalibration={() => setIsCalibrationOpen(true)}
          onOpenDebugger={() => {
            setCurrentScreen('debugger');
            document.body.dataset.state = 'playing';
          }}
          isMuted={isMuted}
          onToggleMute={toggleMute}
        />
      )}

      {currentScreen === 'setup' && (
        <CameraSetupGuide
          onComplete={() => {
            setCurrentScreen('training');
            document.body.dataset.state = 'playing';
          }}
          onBack={handleBackToTitle}
        />
      )}

      {currentScreen === 'training' && (
        <TrainingScreen
          onBackToTitle={handleBackToTitle}
          onOpenCalibration={() => setCurrentScreen('setup')}
          isMuted={isMuted}
          onToggleMute={toggleMute}
        />
      )}

      {currentScreen === 'arena' && (
        <ArenaScreen
          onBackToTitle={handleBackToTitle}
          isMuted={isMuted}
          onToggleMute={toggleMute}
          botDifficulty={botDifficulty}
          multiplayerOpponent={activeMultiplayerOpponent}
        />
      )}

      {currentScreen === 'multiplayer' && (
        <MultiplayerLobby
          onStartMatch={handleMultiplayerMatchStart}
          onBackToTitle={handleBackToTitle}
        />
      )}

      {currentScreen === 'debugger' && (
        <MotionDebugger onBackToTitle={handleBackToTitle} />
      )}

      <CalibrationModal
        isOpen={isCalibrationOpen}
        onClose={() => setIsCalibrationOpen(false)}
      />
    </div>
  );
}
