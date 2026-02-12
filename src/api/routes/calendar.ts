import { Router } from 'express';
import { getCalendarService } from '../../calendar';

export function createCalendarRoutes(): Router {
  const router = Router();

  // List calendars
  router.get('/', async (_req, res, next) => {
    try {
      const calendar = getCalendarService();
      const calendars = await calendar.getCalendars();
      res.json({ calendars });
    } catch (err) {
      next(err);
    }
  });

  // List events
  router.get('/:calendarId/events', async (req, res, next) => {
    try {
      const calendar = getCalendarService();
      const events = await calendar.getEvents(req.params.calendarId, {
        timeMin: req.query.from as string | undefined,
        timeMax: req.query.to as string | undefined,
        maxResults: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        query: req.query.query as string | undefined,
      });
      res.json({ events });
    } catch (err) {
      next(err);
    }
  });

  // Create event
  router.post('/:calendarId/events', async (req, res, next) => {
    try {
      const calendar = getCalendarService();
      const event = await calendar.createEvent(req.params.calendarId, req.body);
      res.status(201).json(event);
    } catch (err) {
      next(err);
    }
  });

  // Update event
  router.patch('/:calendarId/events/:eventId', async (req, res, next) => {
    try {
      const calendar = getCalendarService();
      const event = await calendar.updateEvent(
        req.params.calendarId,
        req.params.eventId,
        req.body
      );
      res.json(event);
    } catch (err) {
      next(err);
    }
  });

  // Delete event
  router.delete('/:calendarId/events/:eventId', async (req, res, next) => {
    try {
      const calendar = getCalendarService();
      await calendar.deleteEvent(req.params.calendarId, req.params.eventId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
