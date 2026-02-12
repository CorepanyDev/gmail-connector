import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../types';
import { GmailServiceError } from '../../gmail';
import { CalendarServiceError } from '../../calendar';
import { TasksServiceError } from '../../tasks';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Handle our own ApiError
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, status: err.statusCode },
    });
    return;
  }

  // Handle service errors
  if (
    err instanceof GmailServiceError ||
    err instanceof CalendarServiceError ||
    err instanceof TasksServiceError
  ) {
    const status = err.code === 'not_authenticated' ? 401 : 500;
    res.status(status).json({
      error: { code: err.code ?? 'service_error', message: err.message, status },
    });
    return;
  }

  // Handle Google API errors (they have a numeric .code property)
  const apiErr = err as Error & { code?: number; errors?: Array<{ message: string }> };
  if (typeof apiErr.code === 'number' && apiErr.code >= 100) {
    const status = apiErr.code;
    res.status(status).json({
      error: { code: 'google_api_error', message: err.message, status },
    });
    return;
  }

  // Fallback
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: { code: 'internal_error', message: 'Internal server error', status: 500 },
  });
}
