// ============================================================================
// Cobble QuickServers - JWT Authentication Middleware
// ============================================================================
// Extracts and verifies Bearer tokens from the Authorization header.
// Populates req.user with the decoded JWT payload on success.
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserPayload } from '../types';

/**
 * Middleware that requires a valid JWT Bearer token.
 *
 * Usage:
 *   router.get('/protected', authenticate, (req, res) => { ... });
 *
 * On success, `req.user` is populated with the decoded UserPayload.
 * On failure, responds with 401 Unauthorized.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: 'No token provided',
      message: 'Authorization header with Bearer token is required.',
    });
    return;
  }

  const token = authHeader.split('Bearer ')[1];

  if (!token) {
    res.status(401).json({
      success: false,
      error: 'No token provided',
      message: 'Bearer token is empty.',
    });
    return;
  }

  try {
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      console.error('[Auth] JWT_SECRET is not configured in environment variables.');
      res.status(500).json({
        success: false,
        error: 'Server configuration error',
      });
      return;
    }

    const decoded = jwt.verify(token, secret) as UserPayload;
    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        success: false,
        error: 'Token expired',
        message: 'Your session has expired. Please log in again.',
      });
      return;
    }

    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        success: false,
        error: 'Invalid token',
        message: 'The provided token is invalid.',
      });
      return;
    }

    res.status(401).json({
      success: false,
      error: 'Authentication failed',
    });
  }
}

/**
 * Optional authentication middleware.
 * If a valid token is present, populates req.user.
 * If no token or invalid token, continues without error.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split('Bearer ')[1];

  if (!token) {
    return next();
  }

  try {
    const secret = process.env.JWT_SECRET;
    if (secret) {
      const decoded = jwt.verify(token, secret) as UserPayload;
      req.user = decoded;
    }
  } catch {
    // Silently continue — token is optional
  }

  next();
}
