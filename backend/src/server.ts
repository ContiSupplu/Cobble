// ============================================================================
// Cobble QuickServers - Main Express Server
// ============================================================================
// Entry point for the backend API. Sets up Express with security middleware,
// mounts route handlers, configures WebSocket support for console streaming,
// and starts listening.
// ============================================================================

import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';

// Route imports
import serversRouter from './routes/servers';
import authRouter from './routes/auth';
import paymentsRouter from './routes/payments';
import pluginsRouter from './routes/plugins';

// Types
import { UserPayload } from './types';

// ============================================================================
// App Configuration
// ============================================================================

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';

// ============================================================================
// Security Middleware
// ============================================================================

// Helmet — sets various HTTP security headers
app.use(helmet());

// CORS — configure allowed origins
app.use(
  cors({
    origin: NODE_ENV === 'production'
      ? ['https://cobble.gg', 'https://www.cobble.gg']
      : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:5174'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Rate limiting — prevent abuse
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,                    // 100 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests, please try again later.',
  },
});

// Apply rate limiting to all API routes
app.use('/api/', apiLimiter);

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 20,                     // 20 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many authentication attempts, please try again later.',
  },
});

// ============================================================================
// Body Parsing
// ============================================================================

// Stripe webhooks need the raw body for signature verification.
// This must be configured BEFORE the global JSON parser.
app.use(
  '/api/payments/webhooks/stripe',
  express.raw({ type: 'application/json' })
);

// JSON body parser for all other routes
app.use(express.json({ limit: '10mb' }));

// URL-encoded body parser
app.use(express.urlencoded({ extended: true }));

// ============================================================================
// Routes
// ============================================================================

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'healthy',
      version: '1.0.0',
      environment: NODE_ENV,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    },
  });
});

// Mount route modules
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/servers', serversRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/plugins', pluginsRouter);

// ============================================================================
// 404 Handler
// ============================================================================

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: `Route ${_req.method} ${_req.originalUrl} does not exist.`,
  });
});

// ============================================================================
// Global Error Handler
// ============================================================================

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Server] Unhandled error:', err);

  // Don't leak error details in production
  const message = NODE_ENV === 'production'
    ? 'An internal server error occurred.'
    : err.message;

  const stack = NODE_ENV === 'production' ? undefined : err.stack;

  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    message,
    ...(stack && { stack }),
  });
});

// ============================================================================
// HTTP Server & WebSocket
// ============================================================================

const httpServer = createServer(app);

// WebSocket server for real-time console streaming
const wss = new WebSocketServer({
  server: httpServer,
  path: '/ws/console',
});

wss.on('connection', (ws: WebSocket, req) => {
  console.log('[WebSocket] New connection attempt');

  // Authenticate via query parameter token
  const url = new URL(req.url || '', `http://localhost:${PORT}`);
  const token = url.searchParams.get('token');

  if (!token) {
    console.log('[WebSocket] Connection rejected: no token');
    ws.close(4001, 'Authentication required');
    return;
  }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      ws.close(4500, 'Server misconfigured');
      return;
    }

    const decoded = jwt.verify(token, secret) as UserPayload;
    const serverId = url.searchParams.get('serverId');

    console.log(
      `[WebSocket] Authenticated: user=${decoded.userId}, server=${serverId}`
    );

    // TODO: Verify user owns the server
    // TODO: Connect to Pterodactyl WebSocket for console streaming
    // TODO: Proxy messages between client and Pterodactyl

    ws.on('message', (data) => {
      const message = data.toString();
      console.log(`[WebSocket] Received from ${decoded.userId}: ${message}`);

      // TODO: Forward command to Pterodactyl console WebSocket

      // Echo back for now (placeholder)
      ws.send(
        JSON.stringify({
          type: 'console_output',
          data: `[Echo] ${message}`,
          timestamp: new Date().toISOString(),
        })
      );
    });

    ws.on('close', (code, reason) => {
      console.log(
        `[WebSocket] Disconnected: user=${decoded.userId}, code=${code}, reason=${reason.toString()}`
      );
    });

    ws.on('error', (error) => {
      console.error(`[WebSocket] Error for user ${decoded.userId}:`, error);
    });

    // Send a welcome message
    ws.send(
      JSON.stringify({
        type: 'connected',
        data: 'Connected to console stream',
        serverId,
        timestamp: new Date().toISOString(),
      })
    );
  } catch (error) {
    console.log('[WebSocket] Connection rejected: invalid token');
    ws.close(4001, 'Invalid token');
  }
});

// ============================================================================
// Start Server
// ============================================================================

httpServer.listen(PORT, () => {
  console.log('');
  console.log('============================================');
  console.log('  Cobble QuickServers API');
  console.log('============================================');
  console.log(`  Environment : ${NODE_ENV}`);
  console.log(`  Port        : ${PORT}`);
  console.log(`  Health      : http://localhost:${PORT}/api/health`);
  console.log(`  WebSocket   : ws://localhost:${PORT}/ws/console`);
  console.log('============================================');
  console.log('');
  console.log('  Routes:');
  console.log('    /api/auth      - Authentication');
  console.log('    /api/servers   - Server management');
  console.log('    /api/payments  - Stripe payments');
  console.log('    /api/plugins   - Plugin management');
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received. Shutting down gracefully...');
  wss.close();
  httpServer.close(() => {
    console.log('[Server] Server closed.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Server] SIGINT received. Shutting down...');
  wss.close();
  httpServer.close(() => {
    console.log('[Server] Server closed.');
    process.exit(0);
  });
});

export default app;
