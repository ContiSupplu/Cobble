// ============================================================================
// Cobble QuickServers - Auth Routes
// ============================================================================
// Placeholder authentication endpoints. These will be connected to a real
// user store (database) and proper password hashing (bcrypt) once the
// infrastructure is set up.
// ============================================================================

import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../middleware/auth';
import {
  RegisterRequest,
  LoginRequest,
  AuthResponse,
  ApiResponse,
  UserPayload,
} from '../types';

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------
// Create a new user account.
// Body: { email, username, password }
// ---------------------------------------------------------------------------
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, username, password } = req.body as RegisterRequest;

    // Validate required fields
    if (!email || !username || !password) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: email, username, password',
      } satisfies ApiResponse);
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({
        success: false,
        error: 'Invalid email format',
      } satisfies ApiResponse);
      return;
    }

    // Validate password length
    if (password.length < 8) {
      res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters',
      } satisfies ApiResponse);
      return;
    }

    // TODO: Check if email/username already exists in database
    // TODO: Hash password with bcrypt
    // TODO: Store user in database

    const userId = uuidv4();
    const now = new Date().toISOString();

    // Create JWT payload
    const payload: UserPayload = {
      userId,
      email,
      username,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET!, {
      expiresIn: process.env.JWT_EXPIRY || '7d',
    });

    const refreshToken = jwt.sign(payload, process.env.JWT_SECRET!, {
      expiresIn: '30d',
    });

    const response: AuthResponse = {
      token,
      refreshToken,
      user: {
        id: userId,
        email,
        username,
        createdAt: now,
      },
    };

    res.status(201).json({
      success: true,
      data: response,
      message: 'Account created successfully',
    } satisfies ApiResponse<AuthResponse>);
  } catch (error) {
    console.error('[Auth] Register error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create account',
    } satisfies ApiResponse);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
// Authenticate user and return JWT tokens.
// Body: { email, password }
// ---------------------------------------------------------------------------
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body as LoginRequest;

    // Validate required fields
    if (!email || !password) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: email, password',
      } satisfies ApiResponse);
      return;
    }

    // TODO: Look up user in database by email
    // TODO: Compare password hash with bcrypt
    // TODO: Return 401 if credentials are invalid

    // Placeholder — simulate a successful login
    const userId = uuidv4();
    const username = email.split('@')[0];

    const payload: UserPayload = {
      userId,
      email,
      username,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET!, {
      expiresIn: process.env.JWT_EXPIRY || '7d',
    });

    const refreshToken = jwt.sign(payload, process.env.JWT_SECRET!, {
      expiresIn: '30d',
    });

    const response: AuthResponse = {
      token,
      refreshToken,
      user: {
        id: userId,
        email,
        username,
        createdAt: new Date().toISOString(),
      },
    };

    res.status(200).json({
      success: true,
      data: response,
    } satisfies ApiResponse<AuthResponse>);
  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed',
    } satisfies ApiResponse);
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
// Get the current authenticated user's profile.
// Requires: Bearer token
// ---------------------------------------------------------------------------
router.get('/me', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;

    // TODO: Fetch full user profile from database

    res.status(200).json({
      success: true,
      data: {
        id: user.userId,
        email: user.email,
        username: user.username,
        createdAt: new Date().toISOString(), // TODO: Pull from DB
      },
    } satisfies ApiResponse);
  } catch (error) {
    console.error('[Auth] Get profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get profile',
    } satisfies ApiResponse);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/refresh
// ---------------------------------------------------------------------------
// Refresh an expired access token using a refresh token.
// Body: { refreshToken }
// ---------------------------------------------------------------------------
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body as { refreshToken: string };

    if (!refreshToken) {
      res.status(400).json({
        success: false,
        error: 'Refresh token is required',
      } satisfies ApiResponse);
      return;
    }

    // Verify the refresh token
    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_SECRET!
    ) as UserPayload;

    // TODO: Check if refresh token is revoked in database
    // TODO: Fetch latest user data from database

    // Issue a new access token
    const newPayload: UserPayload = {
      userId: decoded.userId,
      email: decoded.email,
      username: decoded.username,
    };

    const newToken = jwt.sign(newPayload, process.env.JWT_SECRET!, {
      expiresIn: process.env.JWT_EXPIRY || '7d',
    });

    const newRefreshToken = jwt.sign(newPayload, process.env.JWT_SECRET!, {
      expiresIn: '30d',
    });

    res.status(200).json({
      success: true,
      data: {
        token: newToken,
        refreshToken: newRefreshToken,
      },
    } satisfies ApiResponse);
  } catch (error) {
    console.error('[Auth] Refresh error:', error);
    res.status(401).json({
      success: false,
      error: 'Invalid or expired refresh token',
    } satisfies ApiResponse);
  }
});

export default router;
