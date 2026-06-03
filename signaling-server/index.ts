import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { randomBytes } from 'crypto';

// ── Types ───────────────────────────────────────────────────────────────────────

interface Room {
  id: string;
  hostToken: string;
  joinToken: string;
  host: WebSocket | null;
  joiner: WebSocket | null;
  hostUsername: string;
  joinerUsername: string;
  worldName: string;
  gameVersion: string;
  createdAt: number;
  expiresAt: number;
}

interface ClientMessage {
  type: string;
  username?: string;
  worldName?: string;
  gameVersion?: string;
  roomId?: string;
  token?: string;
  data?: unknown;
}

// ── Constants ───────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '8090', 10);
const ROOM_TTL_MS = 30 * 60 * 1000;           // 30 minutes
const RECONNECT_GRACE_MS = 60 * 1000;          // 60 seconds
const CLEANUP_INTERVAL_MS = 60 * 1000;         // 60 seconds
const RATE_LIMIT_WINDOW_MS = 60 * 1000;        // 1 minute
const RATE_LIMIT_MAX_ROOMS = 10;

// ── State ───────────────────────────────────────────────────────────────────────

const rooms = new Map<string, Room>();
const wsToRoom = new Map<WebSocket, { roomId: string; role: 'host' | 'joiner' }>();
const rateLimits = new Map<string, { count: number; resetAt: number }>();

// ── Helpers ─────────────────────────────────────────────────────────────────────

function generateHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function send(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendError(ws: WebSocket, code: string, message: string): void {
  send(ws, { type: 'error', code, message });
}

function getClientIP(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);

  if (!entry || now >= entry.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX_ROOMS) return false;

  entry.count++;
  return true;
}

function deleteRoom(roomId: string, reason: string): void {
  const room = rooms.get(roomId);
  if (!room) return;

  if (room.host) wsToRoom.delete(room.host);
  if (room.joiner) wsToRoom.delete(room.joiner);
  rooms.delete(roomId);
  log(`Room ${roomId} ${reason}`);
}

// ── Message Handlers ────────────────────────────────────────────────────────────

function handleCreateRoom(ws: WebSocket, msg: ClientMessage, ip: string): void {
  if (!msg.username || !msg.worldName || !msg.gameVersion) {
    return sendError(ws, 'INVALID_MESSAGE', 'Missing required fields: username, worldName, gameVersion');
  }

  if (!checkRateLimit(ip)) {
    return sendError(ws, 'RATE_LIMITED', 'Too many rooms created. Try again later.');
  }

  const now = Date.now();
  const room: Room = {
    id: generateHex(8),
    hostToken: generateHex(16),
    joinToken: generateHex(16),
    host: ws,
    joiner: null,
    hostUsername: msg.username,
    joinerUsername: '',
    worldName: msg.worldName,
    gameVersion: msg.gameVersion,
    createdAt: now,
    expiresAt: now + ROOM_TTL_MS,
  };

  rooms.set(room.id, room);
  wsToRoom.set(ws, { roomId: room.id, role: 'host' });

  send(ws, {
    type: 'room_created',
    roomId: room.id,
    hostToken: room.hostToken,
    joinToken: room.joinToken,
  });

  log(`Room ${room.id} created by ${msg.username}`);
}

function handleJoinRoom(ws: WebSocket, msg: ClientMessage): void {
  if (!msg.roomId || !msg.token || !msg.username) {
    return sendError(ws, 'INVALID_MESSAGE', 'Missing required fields: roomId, token, username');
  }

  const room = rooms.get(msg.roomId);

  if (!room) {
    return sendError(ws, 'ROOM_NOT_FOUND', 'Room does not exist');
  }

  if (Date.now() > room.expiresAt) {
    deleteRoom(room.id, 'expired (join attempt on expired room)');
    return sendError(ws, 'ROOM_NOT_FOUND', 'Room has expired');
  }

  if (msg.token !== room.joinToken) {
    return sendError(ws, 'INVALID_TOKEN', 'Invalid or expired invite link');
  }

  if (room.joiner) {
    return sendError(ws, 'ROOM_FULL', 'Room already has a player');
  }

  room.joiner = ws;
  room.joinerUsername = msg.username;
  wsToRoom.set(ws, { roomId: room.id, role: 'joiner' });

  send(ws, {
    type: 'room_joined',
    hostUsername: room.hostUsername,
    worldName: room.worldName,
    gameVersion: room.gameVersion,
  });

  if (room.host && room.host.readyState === WebSocket.OPEN) {
    send(room.host, { type: 'peer_joined', username: msg.username });
  }

  log(`${msg.username} joined room ${room.id}`);
}

function handleSignal(ws: WebSocket, msg: ClientMessage): void {
  const binding = wsToRoom.get(ws);
  if (!binding) return sendError(ws, 'ROOM_NOT_FOUND', 'You are not in a room');

  const room = rooms.get(binding.roomId);
  if (!room) return sendError(ws, 'ROOM_NOT_FOUND', 'Room does not exist');

  const target = binding.role === 'host' ? room.joiner : room.host;
  const direction = binding.role === 'host' ? 'host → joiner' : 'joiner → host';

  if (target && target.readyState === WebSocket.OPEN) {
    send(target, { type: 'signal', data: msg.data });
    log(`Signal relayed in room ${binding.roomId} (${direction})`);
  }
}

function handleCloseRoom(ws: WebSocket): void {
  const binding = wsToRoom.get(ws);
  if (!binding) return;

  const room = rooms.get(binding.roomId);
  if (!room) return;

  // Notify both peers
  if (room.host && room.host.readyState === WebSocket.OPEN) {
    send(room.host, { type: 'room_closed' });
  }
  if (room.joiner && room.joiner.readyState === WebSocket.OPEN) {
    send(room.joiner, { type: 'room_closed' });
  }

  deleteRoom(binding.roomId, 'closed');
}

// ── Disconnect Handling ─────────────────────────────────────────────────────────

function handleDisconnect(ws: WebSocket): void {
  const binding = wsToRoom.get(ws);
  if (!binding) return;

  const room = rooms.get(binding.roomId);
  if (!room) {
    wsToRoom.delete(ws);
    return;
  }

  if (binding.role === 'host') {
    room.host = null;
    wsToRoom.delete(ws);

    if (room.joiner && room.joiner.readyState === WebSocket.OPEN) {
      send(room.joiner, { type: 'host_disconnected' });
    }

    // Keep room alive for reconnect grace period
    room.expiresAt = Math.min(room.expiresAt, Date.now() + RECONNECT_GRACE_MS);
    log(`Host disconnected from room ${binding.roomId}, grace period started`);
  } else {
    room.joiner = null;
    wsToRoom.delete(ws);

    if (room.host && room.host.readyState === WebSocket.OPEN) {
      send(room.host, { type: 'peer_left', username: room.joinerUsername });
    }

    room.joinerUsername = '';
    log(`Joiner disconnected from room ${binding.roomId}`);
  }
}

// ── Server Setup ────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const ip = getClientIP(req);

  ws.on('message', (raw: Buffer) => {
    let msg: ClientMessage;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.close(4000, 'Invalid JSON');
      return;
    }

    switch (msg.type) {
      case 'create_room':
        handleCreateRoom(ws, msg, ip);
        break;
      case 'join_room':
        handleJoinRoom(ws, msg);
        break;
      case 'signal':
        handleSignal(ws, msg);
        break;
      case 'close_room':
        handleCloseRoom(ws);
        break;
      default:
        sendError(ws, 'INVALID_MESSAGE', 'Unknown message type');
    }
  });

  ws.on('close', () => handleDisconnect(ws));
  ws.on('error', () => handleDisconnect(ws));
});

// ── Cleanup Timer ───────────────────────────────────────────────────────────────

setInterval(() => {
  const now = Date.now();
  let expired = 0;

  for (const [id, room] of rooms) {
    if (now > room.expiresAt) {
      // Notify connected peers before removal
      if (room.host && room.host.readyState === WebSocket.OPEN) {
        send(room.host, { type: 'room_closed' });
      }
      if (room.joiner && room.joiner.readyState === WebSocket.OPEN) {
        send(room.joiner, { type: 'room_closed' });
      }
      deleteRoom(id, 'expired (cleanup)');
      expired++;
    }
  }

  // Also clean stale rate-limit entries
  for (const [ip, entry] of rateLimits) {
    if (now >= entry.resetAt) rateLimits.delete(ip);
  }

  log(`Cleanup: ${expired} expired rooms removed, ${rooms.size} active`);
}, CLEANUP_INTERVAL_MS);

// ── Start ───────────────────────────────────────────────────────────────────────

log(`Loom signaling server listening on ws://localhost:${PORT}`);
