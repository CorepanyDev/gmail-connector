import { Router } from 'express';
import type { gmail_v1 } from 'googleapis';
import { getGmailService } from '../../gmail';

export function createLabelRoutes(): Router {
  const router = Router();

  // List all labels
  router.get('/', async (_req, res, next) => {
    try {
      const gmail = getGmailService();
      const labelsResource = await gmail.getLabels();

      const listResponse = await labelsResource.list({ userId: 'me' });
      const labelList = listResponse.data.labels ?? [];

      // Fetch details for each label
      const labels = await Promise.all(
        labelList.map(async (lbl) => {
          if (!lbl.id) return null;
          try {
            const detail = await labelsResource.get({ userId: 'me', id: lbl.id });
            const d = detail.data;
            return {
              id: d.id,
              name: d.name,
              type: d.type === 'user' ? 'user' : 'system',
              messageCount: d.messagesTotal ?? 0,
              threadsTotal: d.threadsTotal ?? undefined,
              color: d.color
                ? {
                    textColor: d.color.textColor ?? undefined,
                    backgroundColor: d.color.backgroundColor ?? undefined,
                  }
                : undefined,
            };
          } catch {
            return {
              id: lbl.id,
              name: lbl.name,
              type: lbl.type === 'user' ? 'user' : 'system',
              messageCount: 0,
            };
          }
        })
      );

      const filtered = labels.filter(Boolean);
      const systemCount = filtered.filter((l) => l!.type === 'system').length;
      const userCount = filtered.filter((l) => l!.type === 'user').length;

      res.json({
        labels: filtered,
        systemCount,
        userCount,
        totalCount: filtered.length,
      });
    } catch (err) {
      next(err);
    }
  });

  // Create a label
  router.post('/', async (req, res, next) => {
    try {
      const { name, color, visibility } = req.body;
      if (!name || typeof name !== 'string') {
        res.status(400).json({
          error: { code: 'bad_request', message: 'name is required', status: 400 },
        });
        return;
      }

      const gmail = getGmailService();
      const labelsResource = await gmail.getLabels();

      const labelBody: gmail_v1.Schema$Label = {
        name,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      };

      if (visibility) {
        if (visibility.list === 'hide') labelBody.labelListVisibility = 'labelHide';
        if (visibility.message === 'hide') labelBody.messageListVisibility = 'hide';
      }

      if (color && color.backgroundColor) {
        labelBody.color = {
          backgroundColor: color.backgroundColor,
          textColor: color.textColor ?? '#ffffff',
        };
      }

      const createResponse = await labelsResource.create({
        userId: 'me',
        requestBody: labelBody,
      });

      const newLabel = createResponse.data;
      res.status(201).json({
        id: newLabel.id,
        name: newLabel.name,
        color: newLabel.color ?? undefined,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
