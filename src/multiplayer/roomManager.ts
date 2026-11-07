/**
 * Real Multiplayer & Private Room Manager
 * Supports:
 * 1. Generating real shareable 6-digit room codes (e.g. KNT-8492)
 * 2. Cross-device & cross-tab synchronization via BroadcastChannel, LocalStorage & Server Signaling
 * 3. Robust handshake (Announce -> Request -> Accept -> Confirm) with retry loops
 * 4. P2P message passing for game inputs, hits, and match start
 * 5. Host-authoritative combat state synchronization (HP, positions, round timer, hits)
 */

import { ActionType, GameInput, MultiplayerPlayer } from '../types/combat';

export interface MatchSyncState {
  p1Hp: number;
  p1Stamina: number;
  p1X: number;
  p1Action: ActionType;
  p1Phase: string;
  p2Hp: number;
  p2Stamina: number;
  p2X: number;
  p2Action: ActionType;
  p2Phase: string;
  roundTime: number;
  isRoundOver: boolean;
  winnerId: string | null;
  hits?: Array<{ defenderId: string; wasBlocked: boolean; damage: number }>;
}

export interface RoomMessage {
  type:
    | 'QUEUE_ENTER'
    | 'QUEUE_PAIR'
    | 'ROOM_CREATED'
    | 'ROOM_ANNOUNCE'
    | 'ROOM_JOIN_REQUEST'
    | 'ROOM_JOIN_ACCEPTED'
    | 'ROOM_JOIN_CONFIRMED'
    | 'ROOM_LEAVE'
    | 'PLAYER_ACTION'
    | 'MATCH_SYNC'
    | 'PING'
    | 'PONG';
  roomId: string;
  senderId: string;
  senderName: string;
  rank?: string;
  action?: GameInput;
  syncState?: MatchSyncState;
  timestamp: number;
}

export type RoomConnectionState = 'DISCONNECTED' | 'WAITING_FOR_HOST' | 'WAITING_FOR_PEER' | 'CONNECTED';

export interface ActiveRoomSummary {
  code: string;
  hostName: string;
  createdAt: number;
}

export function normalizeRoomCode(raw: string): string {
  if (!raw) return '';
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (!cleaned) return '';

  // If user only typed 4 digits (e.g. "8492")
  if (/^\d{4}$/.test(cleaned)) {
    return `KNT-${cleaned}`;
  }

  // If user typed "KNT8492" without hyphen
  if (/^KNT\d{4}$/.test(cleaned)) {
    return `KNT-${cleaned.substring(3)}`;
  }

  return cleaned;
}

class MultiplayerRoomManager {
  private channel: BroadcastChannel | null = null;
  private localPlayerId: string;
  private localPlayerName: string = 'FIGHTER_1';
  private currentRoomCode: string | null = null;
  private isHost: boolean = false;
  private remotePeer: MultiplayerPlayer | null = null;
  private connectionState: RoomConnectionState = 'DISCONNECTED';

  // Timers
  private announceInterval: number | null = null;
  private joinRetryInterval: number | null = null;
  private pollInterval: number | null = null;
  private pingInterval: number | null = null;
  private lastServerMsgId: number = 0;

  // Deduplication cache
  private seenMessageKeys: Set<string> = new Set();

  // Listeners
  private onPeerConnectedCallback?: (peer: MultiplayerPlayer, isHost: boolean) => void;
  private onPeerDisconnectedCallback?: () => void;
  private onPeerActionCallback?: (action: GameInput) => void;
  private onSyncStateCallback?: (state: MatchSyncState) => void;
  private onStateChangeCallback?: (state: RoomConnectionState) => void;

  constructor() {
    this.localPlayerId = 'p_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    this.initTransports();
  }

  private initTransports() {
    // 1. BroadcastChannel (fast local tab communication)
    if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel('kinetic_clash_p2p_network');
        this.channel.onmessage = (event: MessageEvent<RoomMessage>) => {
          this.handleIncomingMessage(event.data);
        };
      } catch (e) {
        console.warn('BroadcastChannel not available:', e);
      }
    }

    // 2. Storage event listener (syncs across tabs and windows of same browser)
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (event: StorageEvent) => {
        if (event.key === 'kinetic_clash_sync_msg' && event.newValue) {
          try {
            const data = JSON.parse(event.newValue);
            if (data && data.msg) {
              this.handleIncomingMessage(data.msg);
            }
          } catch (e) {
            // ignore
          }
        }
      });
    }
  }

  public setPlayerName(name: string) {
    this.localPlayerName = name;
  }

  public getPlayerId(): string {
    return this.localPlayerId;
  }

  public getCurrentRoomCode(): string | null {
    return this.currentRoomCode;
  }

  public getRemotePeer(): MultiplayerPlayer | null {
    return this.remotePeer;
  }

  public getIsHost(): boolean {
    return this.isHost;
  }

  public getConnectionState(): RoomConnectionState {
    return this.connectionState;
  }

  /**
   * Generates a 6-digit shareable room code (e.g. KNT-8492) and advertises as host
   */
  public createPrivateRoom(): string {
    this.leaveRoom();

    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const code = `KNT-${randomDigits}`;
    this.currentRoomCode = code;
    this.isHost = true;
    this.remotePeer = null;
    this.lastServerMsgId = 0;
    this.updateState('WAITING_FOR_PEER');

    // Register active room in localStorage & server
    this.registerRoomInStorage(code);

    // Initial announcement
    const announceMsg: RoomMessage = {
      type: 'ROOM_CREATED',
      roomId: code,
      senderId: this.localPlayerId,
      senderName: this.localPlayerName,
      timestamp: Date.now(),
    };
    this.sendMessage(announceMsg);

    // Continuous heartbeat announcement while waiting
    if (typeof window !== 'undefined') {
      this.announceInterval = window.setInterval(() => {
        if (this.connectionState === 'WAITING_FOR_PEER' && this.currentRoomCode === code) {
          this.sendMessage({
            type: 'ROOM_ANNOUNCE',
            roomId: code,
            senderId: this.localPlayerId,
            senderName: this.localPlayerName,
            timestamp: Date.now(),
          });
        } else {
          this.clearAnnounceInterval();
        }
      }, 1200);

      this.startServerPolling(code);
    }

    return code;
  }

  /**
   * Joins an existing private room code entered by the user
   */
  public joinPrivateRoom(code: string): boolean {
    this.leaveRoom();

    const formatted = normalizeRoomCode(code);
    if (!formatted) return false;

    this.currentRoomCode = formatted;
    this.isHost = false;
    this.remotePeer = null;
    this.lastServerMsgId = 0;
    this.updateState('WAITING_FOR_HOST');

    const sendJoinRequest = () => {
      this.sendMessage({
        type: 'ROOM_JOIN_REQUEST',
        roomId: formatted,
        senderId: this.localPlayerId,
        senderName: this.localPlayerName,
        timestamp: Date.now(),
      });
    };

    // Send immediately
    sendJoinRequest();

    // Retry sending join request periodically until host accepts
    if (typeof window !== 'undefined') {
      this.joinRetryInterval = window.setInterval(() => {
        if (this.connectionState === 'WAITING_FOR_HOST' && this.currentRoomCode === formatted) {
          sendJoinRequest();
        } else {
          this.clearJoinRetryInterval();
        }
      }, 750);

      this.startServerPolling(formatted);
    }

    return true;
  }

  /**
   * Enters the real Quick Match queue.
   */
  public enterQuickMatchQueue(): void {
    this.leaveRoom();

    const queueRoomId = 'GLOBAL_QUICK_QUEUE';
    this.currentRoomCode = queueRoomId;
    this.isHost = false;
    this.remotePeer = null;
    this.lastServerMsgId = 0;
    this.updateState('WAITING_FOR_PEER');

    const sendQueueMsg = () => {
      this.sendMessage({
        type: 'QUEUE_ENTER',
        roomId: queueRoomId,
        senderId: this.localPlayerId,
        senderName: this.localPlayerName,
        rank: 'CONTENDER II',
        timestamp: Date.now(),
      });
    };

    sendQueueMsg();

    if (typeof window !== 'undefined') {
      this.announceInterval = window.setInterval(() => {
        if (this.connectionState === 'WAITING_FOR_PEER' && this.currentRoomCode === queueRoomId) {
          sendQueueMsg();
        } else {
          this.clearAnnounceInterval();
        }
      }, 1500);

      this.startServerPolling(queueRoomId);
    }
  }

  /**
   * Leave current room or queue
   */
  public leaveRoom(): void {
    this.clearAnnounceInterval();
    this.clearJoinRetryInterval();
    this.clearServerPolling();
    this.clearPingInterval();

    if (this.currentRoomCode) {
      this.sendMessage({
        type: 'ROOM_LEAVE',
        roomId: this.currentRoomCode,
        senderId: this.localPlayerId,
        senderName: this.localPlayerName,
        timestamp: Date.now(),
      });
      this.unregisterRoomFromStorage(this.currentRoomCode);
    }

    this.currentRoomCode = null;
    this.isHost = false;
    this.remotePeer = null;
    this.updateState('DISCONNECTED');
  }

  /**
   * Transmit action to peer
   */
  public sendAction(action: GameInput): void {
    if (!this.currentRoomCode || this.connectionState !== 'CONNECTED') return;

    this.sendMessage({
      type: 'PLAYER_ACTION',
      roomId: this.currentRoomCode,
      senderId: this.localPlayerId,
      senderName: this.localPlayerName,
      action,
      timestamp: Date.now(),
    });
  }

  /**
   * Transmit authoritative state from Host to Guest
   */
  public sendSyncState(syncState: MatchSyncState): void {
    if (!this.currentRoomCode || this.connectionState !== 'CONNECTED' || !this.isHost) return;

    this.sendMessage({
      type: 'MATCH_SYNC',
      roomId: this.currentRoomCode,
      senderId: this.localPlayerId,
      senderName: this.localPlayerName,
      syncState,
      timestamp: Date.now(),
    });
  }

  // Event subscription hooks
  public onPeerConnected(cb: (peer: MultiplayerPlayer, isHost: boolean) => void) {
    this.onPeerConnectedCallback = cb;
  }

  public onPeerDisconnected(cb: () => void) {
    this.onPeerDisconnectedCallback = cb;
  }

  public onPeerAction(cb: (action: GameInput) => void) {
    this.onPeerActionCallback = cb;
  }

  public onSyncState(cb: (state: MatchSyncState) => void) {
    this.onSyncStateCallback = cb;
  }

  public onStateChange(cb: (state: RoomConnectionState) => void) {
    this.onStateChangeCallback = cb;
  }

  private updateState(state: RoomConnectionState) {
    this.connectionState = state;
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback(state);
    }
  }

  private sendMessage(msg: RoomMessage) {
    // 1. BroadcastChannel (same browser profile)
    if (this.channel) {
      try {
        this.channel.postMessage(msg);
      } catch (e) {
        console.warn('BroadcastChannel send error:', e);
      }
    }

    // 2. LocalStorage sync event (cross-tab fallback)
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(
          'kinetic_clash_sync_msg',
          JSON.stringify({ msg, t: Date.now(), rand: Math.random() })
        );
      } catch (e) {
        // ignore
      }
    }

    // 3. HTTP Server Signaling (cross-device on network)
    if (typeof fetch !== 'undefined') {
      fetch('/api/multiplayer/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg),
      }).catch(() => {
        // Non-fatal if offline
      });
    }
  }

  private startServerPolling(roomId: string) {
    this.clearServerPolling();
    if (typeof window === 'undefined') return;

    const poll = async () => {
      if (!this.currentRoomCode || this.currentRoomCode !== roomId) return;

      try {
        const res = await fetch(
          `/api/multiplayer/poll?roomId=${encodeURIComponent(roomId)}&since=${this.lastServerMsgId}&senderId=${encodeURIComponent(this.localPlayerId)}`
        );
        if (res.ok) {
          const data = await res.json();
          if (data.lastId) {
            this.lastServerMsgId = data.lastId;
          }
          if (Array.isArray(data.messages)) {
            data.messages.forEach((m: RoomMessage) => this.handleIncomingMessage(m));
          }
        }
      } catch (e) {
        // Ignore network polling error
      }
    };

    poll();
    this.pollInterval = window.setInterval(poll, 120);
  }

  private startKeepAlivePing() {
    this.clearPingInterval();
    if (typeof window === 'undefined') return;

    this.pingInterval = window.setInterval(() => {
      if (this.connectionState === 'CONNECTED' && this.currentRoomCode) {
        this.sendMessage({
          type: 'PING',
          roomId: this.currentRoomCode,
          senderId: this.localPlayerId,
          senderName: this.localPlayerName,
          timestamp: Date.now(),
        });
      }
    }, 2500);
  }

  private clearAnnounceInterval() {
    if (this.announceInterval !== null) {
      clearInterval(this.announceInterval);
      this.announceInterval = null;
    }
  }

  private clearJoinRetryInterval() {
    if (this.joinRetryInterval !== null) {
      clearInterval(this.joinRetryInterval);
      this.joinRetryInterval = null;
    }
  }

  private clearServerPolling() {
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private clearPingInterval() {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private handleIncomingMessage(msg: RoomMessage) {
    if (!msg || !msg.type || !msg.senderId) return;

    // Ignore messages from self
    if (msg.senderId === this.localPlayerId) return;

    // Deduplication check
    const dedupKey = `${msg.senderId}_${msg.type}_${msg.timestamp}_${msg.action?.timestamp || ''}_${msg.syncState?.roundTime || ''}`;
    if (this.seenMessageKeys.has(dedupKey)) return;
    this.seenMessageKeys.add(dedupKey);

    if (this.seenMessageKeys.size > 250) {
      const it = this.seenMessageKeys.values();
      for (let i = 0; i < 60; i++) {
        const val = it.next().value;
        if (val) this.seenMessageKeys.delete(val);
      }
    }

    // Handle Quick Match Queue
    if (this.currentRoomCode === 'GLOBAL_QUICK_QUEUE' && msg.roomId === 'GLOBAL_QUICK_QUEUE') {
      if (msg.type === 'QUEUE_ENTER') {
        const iAmHost = this.localPlayerId < msg.senderId;
        const matchedRoom = `MATCH_${Math.min(this.localPlayerId.length, 5)}_${Date.now()}`;
        this.isHost = iAmHost;
        this.currentRoomCode = matchedRoom;

        const peer: MultiplayerPlayer = {
          id: msg.senderId,
          name: msg.senderName || 'CHALLENGER_ONE',
          rank: msg.rank || 'CONTENDER II',
          pingMs: Math.max(12, Math.round(Math.abs(Date.now() - msg.timestamp) / 2)),
          isReady: true,
        };
        this.remotePeer = peer;
        this.updateState('CONNECTED');
        this.clearAnnounceInterval();
        this.startServerPolling(matchedRoom);
        this.startKeepAlivePing();

        this.sendMessage({
          type: 'QUEUE_PAIR',
          roomId: 'GLOBAL_QUICK_QUEUE',
          senderId: this.localPlayerId,
          senderName: this.localPlayerName,
          rank: 'CONTENDER II',
          timestamp: Date.now(),
        });

        if (this.onPeerConnectedCallback) {
          this.onPeerConnectedCallback(peer, this.isHost);
        }
      } else if (msg.type === 'QUEUE_PAIR') {
        const iAmHost = this.localPlayerId < msg.senderId;
        this.isHost = iAmHost;
        const peer: MultiplayerPlayer = {
          id: msg.senderId,
          name: msg.senderName || 'CHALLENGER_TWO',
          rank: msg.rank || 'CONTENDER II',
          pingMs: Math.max(12, Math.round(Math.abs(Date.now() - msg.timestamp) / 2)),
          isReady: true,
        };
        this.remotePeer = peer;
        this.updateState('CONNECTED');
        this.clearAnnounceInterval();
        this.startKeepAlivePing();

        if (this.onPeerConnectedCallback) {
          this.onPeerConnectedCallback(peer, this.isHost);
        }
      }
      return;
    }

    // Handle Private Room Code messages
    if (msg.roomId === this.currentRoomCode) {
      // 1. Host receives Join Request
      if (msg.type === 'ROOM_JOIN_REQUEST' && this.isHost) {
        this.clearAnnounceInterval();

        const peer: MultiplayerPlayer = {
          id: msg.senderId,
          name: msg.senderName || 'CHALLENGER',
          rank: 'CONTENDER I',
          pingMs: Math.max(10, Math.round(Math.abs(Date.now() - msg.timestamp) / 2)),
          isReady: true,
        };
        this.remotePeer = peer;
        this.updateState('CONNECTED');
        this.startKeepAlivePing();

        // Send Acceptance
        this.sendMessage({
          type: 'ROOM_JOIN_ACCEPTED',
          roomId: this.currentRoomCode,
          senderId: this.localPlayerId,
          senderName: this.localPlayerName,
          timestamp: Date.now(),
        });

        if (this.onPeerConnectedCallback) {
          this.onPeerConnectedCallback(peer, true);
        }
      }

      // 2. Joiner receives Join Accepted
      else if (msg.type === 'ROOM_JOIN_ACCEPTED' && !this.isHost) {
        this.clearJoinRetryInterval();

        const peer: MultiplayerPlayer = {
          id: msg.senderId,
          name: msg.senderName || 'ROOM_HOST',
          rank: 'CONTENDER I',
          pingMs: Math.max(10, Math.round(Math.abs(Date.now() - msg.timestamp) / 2)),
          isReady: true,
        };
        this.remotePeer = peer;
        this.updateState('CONNECTED');
        this.startKeepAlivePing();

        // Send Confirmation back to host
        this.sendMessage({
          type: 'ROOM_JOIN_CONFIRMED',
          roomId: this.currentRoomCode,
          senderId: this.localPlayerId,
          senderName: this.localPlayerName,
          timestamp: Date.now(),
        });

        if (this.onPeerConnectedCallback) {
          this.onPeerConnectedCallback(peer, false);
        }
      }

      // 3. Host receives Confirmation
      else if (msg.type === 'ROOM_JOIN_CONFIRMED' && this.isHost) {
        if (this.remotePeer) {
          this.remotePeer.isReady = true;
        }
      }

      // 4. Joiner sees announcement while waiting -> immediately trigger request
      else if ((msg.type === 'ROOM_ANNOUNCE' || msg.type === 'ROOM_CREATED') && !this.isHost && this.connectionState === 'WAITING_FOR_HOST') {
        this.sendMessage({
          type: 'ROOM_JOIN_REQUEST',
          roomId: this.currentRoomCode,
          senderId: this.localPlayerId,
          senderName: this.localPlayerName,
          timestamp: Date.now(),
        });
      }

      // 5. Player Actions in Combat
      else if (msg.type === 'PLAYER_ACTION' && msg.action) {
        if (this.onPeerActionCallback) {
          this.onPeerActionCallback(msg.action);
        }
      }

      // 6. Host-Authoritative Combat State Sync (Guest receives)
      else if (msg.type === 'MATCH_SYNC' && msg.syncState && !this.isHost) {
        if (this.onSyncStateCallback) {
          this.onSyncStateCallback(msg.syncState);
        }
      }

      // 7. Ping / Pong
      else if (msg.type === 'PING') {
        this.sendMessage({
          type: 'PONG',
          roomId: this.currentRoomCode,
          senderId: this.localPlayerId,
          senderName: this.localPlayerName,
          timestamp: Date.now(),
        });
      } else if (msg.type === 'PONG') {
        if (this.remotePeer) {
          this.remotePeer.pingMs = Math.max(8, Math.round(Math.abs(Date.now() - msg.timestamp) / 2));
        }
      }

      // 8. Peer leaves
      else if (msg.type === 'ROOM_LEAVE') {
        this.remotePeer = null;
        this.updateState('DISCONNECTED');
        this.clearKeepAlive();
        if (this.onPeerDisconnectedCallback) {
          this.onPeerDisconnectedCallback();
        }
      }
    }
  }

  private clearKeepAlive() {
    this.clearPingInterval();
    this.clearAnnounceInterval();
    this.clearJoinRetryInterval();
  }

  private registerRoomInStorage(code: string) {
    if (typeof localStorage === 'undefined') return;
    try {
      const active = JSON.parse(localStorage.getItem('kinetic_clash_rooms') || '{}');
      active[code] = {
        hostId: this.localPlayerId,
        hostName: this.localPlayerName,
        createdAt: Date.now(),
      };
      localStorage.setItem('kinetic_clash_rooms', JSON.stringify(active));
    } catch (e) {
      // Ignore
    }
  }

  private unregisterRoomFromStorage(code: string) {
    if (typeof localStorage === 'undefined') return;
    try {
      const active = JSON.parse(localStorage.getItem('kinetic_clash_rooms') || '{}');
      delete active[code];
      localStorage.setItem('kinetic_clash_rooms', JSON.stringify(active));
    } catch (e) {
      // Ignore
    }
  }

  /**
   * Discovers active waiting rooms from storage and server
   */
  public async getActiveRooms(): Promise<ActiveRoomSummary[]> {
    const map = new Map<string, ActiveRoomSummary>();

    // 1. From localStorage
    if (typeof localStorage !== 'undefined') {
      try {
        const stored = JSON.parse(localStorage.getItem('kinetic_clash_rooms') || '{}');
        const now = Date.now();
        for (const [code, info] of Object.entries(stored) as any) {
          if (now - info.createdAt < 60000 && info.hostId !== this.localPlayerId) {
            map.set(code, {
              code,
              hostName: info.hostName || 'HOST',
              createdAt: info.createdAt,
            });
          }
        }
      } catch (e) {}
    }

    // 2. From Server
    if (typeof fetch !== 'undefined') {
      try {
        const res = await fetch('/api/multiplayer/rooms');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.rooms)) {
            data.rooms.forEach((r: any) => {
              if (r.code && (!map.has(r.code) || map.get(r.code)!.hostName === 'HOST')) {
                map.set(r.code, {
                  code: r.code,
                  hostName: r.hostName || 'HOST',
                  createdAt: r.createdAt || Date.now(),
                });
              }
            });
          }
        }
      } catch (e) {}
    }

    return Array.from(map.values());
  }
}

export const multiplayerRoomManager = new MultiplayerRoomManager();
