import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../types';

export function createAuthMiddleware(apiKey: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // Skip auth for health endpoint
    if (req.path === '/api/health') {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(new ApiError(401, 'Missing or invalid Authorization header', 'unauthorized'));
    }

    const token = authHeader.slice(7);

    // Use timing-safe comparison to prevent timing attacks
    const tokenBuffer = Buffer.from(token);
    const keyBuffer = Buffer.from(apiKey);

    if (tokenBuffer.length !== keyBuffer.length || !crypto.timingSafeEqual(tokenBuffer, keyBuffer)) {
      return next(new ApiError(401, 'Invalid API key', 'unauthorized'));
    }

    next();
  };
}
