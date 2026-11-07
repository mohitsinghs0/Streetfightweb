import type { Plugin } from 'vite';

interface StoredMessage {
  id: number;
  roomId: string;
  senderId: string;
  msg: any;
  timestamp: number;
}

export function multiplayerSignalingPlugin(): Plugin {
  return {
    name: 'multiplayer-signaling',
    configureServer(server) {
      const roomMessages = new Map<string, StoredMessage[]>();
      const activeRooms = new Map<string, { hostId: string; hostName: string; updatedAt: number }>();
      let messageIdCounter = 0;

      // Clean up stale rooms and messages older than 2 minutes
      setInterval(() => {
        const now = Date.now();
        for (const [roomId, msgs] of roomMessages.entries()) {
          const fresh = msgs.filter((m) => now - m.timestamp < 120000);
          if (fresh.length === 0) {
            roomMessages.delete(roomId);
          } else {
            roomMessages.set(roomId, fresh);
          }
        }
        for (const [code, info] of activeRooms.entries()) {
          if (now - info.updatedAt > 60000) {
            activeRooms.delete(code);
          }
        }
      }, 15000);

      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/multiplayer/')) {
          return next();
        }

        const url = new URL(req.url, 'http://localhost');
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        // POST /api/multiplayer/send
        if (url.pathname === '/api/multiplayer/send' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', () => {
            try {
              const msg = JSON.parse(body);
              if (msg && msg.roomId) {
                const list = roomMessages.get(msg.roomId) || [];
                messageIdCounter++;
                list.push({
                  id: messageIdCounter,
                  roomId: msg.roomId,
                  senderId: msg.senderId,
                  msg,
                  timestamp: Date.now(),
                });
                // Keep max 150 messages per room
                if (list.length > 150) list.shift();
                roomMessages.set(msg.roomId, list);

                // Update active rooms catalogue if ROOM_CREATED or ROOM_ANNOUNCE
                if (msg.type === 'ROOM_CREATED' || msg.type === 'ROOM_ANNOUNCE') {
                  activeRooms.set(msg.roomId, {
                    hostId: msg.senderId,
                    hostName: msg.senderName || 'HOST',
                    updatedAt: Date.now(),
                  });
                } else if (msg.type === 'ROOM_LEAVE') {
                  activeRooms.delete(msg.roomId);
                }
              }
              res.statusCode = 200;
              res.end(JSON.stringify({ ok: true, id: messageIdCounter }));
            } catch (err) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
          return;
        }

        // GET /api/multiplayer/poll?roomId=...&since=...&senderId=...
        if (url.pathname === '/api/multiplayer/poll' && req.method === 'GET') {
          const roomId = url.searchParams.get('roomId');
          const sinceId = parseInt(url.searchParams.get('since') || '0', 10);
          const senderId = url.searchParams.get('senderId') || '';

          if (!roomId) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing roomId' }));
            return;
          }

          const list = roomMessages.get(roomId) || [];
          const newMsgs = list.filter((m) => m.id > sinceId && m.senderId !== senderId);
          const maxId = list.length > 0 ? list[list.length - 1].id : sinceId;

          res.statusCode = 200;
          res.end(JSON.stringify({ messages: newMsgs.map((m) => m.msg), lastId: maxId }));
          return;
        }

        // GET /api/multiplayer/rooms
        if (url.pathname === '/api/multiplayer/rooms' && req.method === 'GET') {
          const now = Date.now();
          const rooms = Array.from(activeRooms.entries())
            .filter(([_, info]) => now - info.updatedAt < 45000)
            .map(([code, info]) => ({
              code,
              hostName: info.hostName,
              createdAt: info.updatedAt,
            }));

          res.statusCode = 200;
          res.end(JSON.stringify({ rooms }));
          return;
        }

        next();
      });
    },
  };
}
