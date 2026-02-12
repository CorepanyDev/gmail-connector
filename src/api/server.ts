import express from 'express';
import { createAuthMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/error-handler';
import { createHealthRoutes } from './routes/health';
import { createGmailRoutes } from './routes/gmail';
import { createLabelRoutes } from './routes/labels';
import { createStatsRoutes } from './routes/stats';
import { createCalendarRoutes } from './routes/calendar';
import { createTaskRoutes } from './routes/tasks';
import type { ApiConfig } from './types';

export function createApp(config: ApiConfig): express.Express {
  const app = express();

  app.use(express.json());
  app.use(createAuthMiddleware(config.apiKey));

  // Routes
  app.use('/api', createHealthRoutes());
  app.use('/api/gmail', createGmailRoutes());
  app.use('/api/gmail/labels', createLabelRoutes());
  app.use('/api/gmail/stats', createStatsRoutes());
  app.use('/api/calendars', createCalendarRoutes());
  app.use('/api/tasks', createTaskRoutes());

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}

export function startServer(config: ApiConfig): void {
  const app = createApp(config);

  app.listen(config.port, () => {
    console.log(`gmail-connector API server listening on http://localhost:${config.port}`);
    console.log(`Health check: http://localhost:${config.port}/api/health`);
    if (config.verbose) {
      console.log('Verbose mode enabled');
    }
  });
}
