import { Router } from 'express';
import { getGmailService } from '../../gmail';

export function createHealthRoutes(): Router {
  const router = Router();

  // Health check (no auth required)
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Auth status (requires auth)
  router.get('/auth/status', async (_req, res, next) => {
    try {
      const gmail = getGmailService();
      const authenticated = await gmail.isAuthenticated();

      if (!authenticated) {
        res.json({ authenticated: false });
        return;
      }

      const profile = await gmail.getProfile();
      res.json({
        authenticated: true,
        email: profile.emailAddress,
        messagesTotal: profile.messagesTotal,
        threadsTotal: profile.threadsTotal,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
