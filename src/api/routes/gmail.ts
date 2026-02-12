import { Router } from 'express';
import type { gmail_v1 } from 'googleapis';
import { getGmailService } from '../../gmail';
import { ApiError } from '../types';

function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string {
  if (!headers) return '';
  const header = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return header?.value ?? '';
}

function parseFromAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

function decodeBase64Url(encoded: string): string {
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): { text: string; html?: string } {
  if (!payload) return { text: '' };
  const result: { text: string; html?: string } = { text: '' };

  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === 'text/html') {
      result.html = decoded;
    } else if (payload.mimeType === 'text/plain') {
      result.text = decoded;
    }
    return result;
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        result.text = decodeBase64Url(part.body.data);
      } else if (part.mimeType === 'text/html' && part.body?.data) {
        result.html = decodeBase64Url(part.body.data);
      } else if (part.mimeType?.startsWith('multipart/')) {
        const nested = extractBody(part);
        if (nested.text && !result.text) result.text = nested.text;
        if (nested.html && !result.html) result.html = nested.html;
      }
    }
  }

  return result;
}

function extractAttachments(payload: gmail_v1.Schema$MessagePart | undefined) {
  const attachments: Array<{
    filename: string;
    mimeType: string;
    size: number;
    attachmentId: string;
  }> = [];

  function traverse(part: gmail_v1.Schema$MessagePart): void {
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType ?? 'application/octet-stream',
        size: part.body.size ?? 0,
        attachmentId: part.body.attachmentId,
      });
    }
    if (part.parts) {
      for (const child of part.parts) {
        traverse(child);
      }
    }
  }

  if (payload) traverse(payload);
  return attachments;
}

export function createGmailRoutes(): Router {
  const router = Router();

  // List inbox messages
  router.get('/messages', async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 500);
      const pageToken = req.query.pageToken as string | undefined;

      const gmail = getGmailService();
      const messages = await gmail.getMessages();

      const listResponse = await messages.list({
        userId: 'me',
        labelIds: ['INBOX'],
        maxResults: limit,
        pageToken,
      });

      const messageList = listResponse.data.messages ?? [];

      // Fetch metadata for each message
      const emails = await Promise.all(
        messageList.map(async (msg) => {
          if (!msg.id) return null;
          const detail = await messages.get({
            userId: 'me',
            id: msg.id,
            format: 'metadata',
            metadataHeaders: ['Date', 'From', 'Subject'],
          });
          const headers = detail.data.payload?.headers;
          return {
            id: detail.data.id,
            date: getHeader(headers, 'Date'),
            from: parseFromAddress(getHeader(headers, 'From')),
            subject: getHeader(headers, 'Subject') || '(no subject)',
            snippet: detail.data.snippet,
          };
        })
      );

      res.json({
        emails: emails.filter(Boolean),
        nextPageToken: listResponse.data.nextPageToken ?? undefined,
        resultSizeEstimate: listResponse.data.resultSizeEstimate ?? undefined,
      });
    } catch (err) {
      next(err);
    }
  });

  // Search messages
  router.get('/messages/search', async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 500);
      const pageToken = req.query.pageToken as string | undefined;
      const searchAll = req.query.all === 'true';

      // Build query from params
      const queryParts: string[] = [];
      if (req.query.q) queryParts.push(req.query.q as string);
      if (req.query.from) queryParts.push(`from:${req.query.from}`);
      if (req.query.to) queryParts.push(`to:${req.query.to}`);
      if (req.query.subject) queryParts.push(`subject:${req.query.subject}`);
      if (req.query.hasAttachment === 'true') queryParts.push('has:attachment');

      let finalQuery = queryParts.join(' ');
      if (!searchAll && finalQuery) {
        finalQuery = `in:inbox ${finalQuery}`;
      } else if (!searchAll) {
        finalQuery = 'in:inbox';
      }

      if (!finalQuery) {
        throw new ApiError(400, 'No search query provided', 'bad_request');
      }

      const gmail = getGmailService();
      const messages = await gmail.getMessages();

      const searchResponse = await messages.list({
        userId: 'me',
        q: finalQuery,
        maxResults: limit,
        pageToken,
      });

      const messageList = searchResponse.data.messages ?? [];

      const emails = await Promise.all(
        messageList.map(async (msg) => {
          if (!msg.id) return null;
          const detail = await messages.get({
            userId: 'me',
            id: msg.id,
            format: 'metadata',
            metadataHeaders: ['Date', 'From', 'Subject'],
          });
          const headers = detail.data.payload?.headers;
          return {
            id: detail.data.id,
            date: getHeader(headers, 'Date'),
            from: parseFromAddress(getHeader(headers, 'From')),
            subject: getHeader(headers, 'Subject') || '(no subject)',
            snippet: detail.data.snippet,
          };
        })
      );

      res.json({
        query: finalQuery,
        emails: emails.filter(Boolean),
        count: emails.filter(Boolean).length,
        nextPageToken: searchResponse.data.nextPageToken ?? undefined,
        resultSizeEstimate: searchResponse.data.resultSizeEstimate ?? undefined,
      });
    } catch (err) {
      next(err);
    }
  });

  // Get message detail
  router.get('/messages/:id', async (req, res, next) => {
    try {
      const gmail = getGmailService();
      const messages = await gmail.getMessages();
      const full = req.query.full === 'true';

      const response = await messages.get({
        userId: 'me',
        id: req.params.id,
        format: 'full',
      });

      const message = response.data;
      const headers = message.payload?.headers;
      const bodyContent = extractBody(message.payload);

      const detail: Record<string, unknown> = {
        id: message.id,
        threadId: message.threadId,
        from: getHeader(headers, 'From'),
        to: getHeader(headers, 'To'),
        cc: getHeader(headers, 'Cc'),
        date: getHeader(headers, 'Date'),
        subject: getHeader(headers, 'Subject') || '(no subject)',
        snippet: message.snippet,
        labels: message.labelIds,
        sizeEstimate: message.sizeEstimate,
        attachments: extractAttachments(message.payload),
      };

      if (full) {
        detail.body = bodyContent.text;
        detail.bodyHtml = bodyContent.html;
      } else {
        detail.body = bodyContent.text?.slice(0, 500);
      }

      res.json(detail);
    } catch (err) {
      next(err);
    }
  });

  // List attachments for a message
  router.get('/messages/:id/attachments', async (req, res, next) => {
    try {
      const gmail = getGmailService();
      const messages = await gmail.getMessages();

      const response = await messages.get({
        userId: 'me',
        id: req.params.id,
        format: 'full',
      });

      res.json({ attachments: extractAttachments(response.data.payload) });
    } catch (err) {
      next(err);
    }
  });

  // Archive messages
  router.post('/messages/archive', async (req, res, next) => {
    try {
      const { messageIds } = req.body;
      if (!Array.isArray(messageIds) || messageIds.length === 0) {
        throw new ApiError(400, 'messageIds must be a non-empty array', 'bad_request');
      }

      const gmail = getGmailService();
      const messages = await gmail.getMessages();
      let success = 0;
      let failed = 0;

      for (const id of messageIds) {
        try {
          await messages.modify({
            userId: 'me',
            id,
            requestBody: { removeLabelIds: ['INBOX'] },
          });
          success++;
        } catch {
          failed++;
        }
      }

      res.json({ success, failed, total: messageIds.length });
    } catch (err) {
      next(err);
    }
  });

  // Trash messages
  router.post('/messages/trash', async (req, res, next) => {
    try {
      const { messageIds } = req.body;
      if (!Array.isArray(messageIds) || messageIds.length === 0) {
        throw new ApiError(400, 'messageIds must be a non-empty array', 'bad_request');
      }

      const gmail = getGmailService();
      const messages = await gmail.getMessages();
      let success = 0;
      let failed = 0;

      for (const id of messageIds) {
        try {
          await messages.trash({ userId: 'me', id });
          success++;
        } catch {
          failed++;
        }
      }

      res.json({ success, failed, total: messageIds.length });
    } catch (err) {
      next(err);
    }
  });

  // Mark read/unread
  router.post('/messages/mark', async (req, res, next) => {
    try {
      const { messageIds, action } = req.body;
      if (!Array.isArray(messageIds) || messageIds.length === 0) {
        throw new ApiError(400, 'messageIds must be a non-empty array', 'bad_request');
      }
      if (action !== 'read' && action !== 'unread') {
        throw new ApiError(400, 'action must be "read" or "unread"', 'bad_request');
      }

      const gmail = getGmailService();
      const messages = await gmail.getMessages();
      let success = 0;
      let failed = 0;

      const body =
        action === 'read'
          ? { removeLabelIds: ['UNREAD'] }
          : { addLabelIds: ['UNREAD'] };

      for (const id of messageIds) {
        try {
          await messages.modify({ userId: 'me', id, requestBody: body });
          success++;
        } catch {
          failed++;
        }
      }

      res.json({ success, failed, total: messageIds.length });
    } catch (err) {
      next(err);
    }
  });

  // Add/remove label
  router.post('/messages/label', async (req, res, next) => {
    try {
      const { messageIds, action, label, create } = req.body;
      if (!Array.isArray(messageIds) || messageIds.length === 0) {
        throw new ApiError(400, 'messageIds must be a non-empty array', 'bad_request');
      }
      if (action !== 'add' && action !== 'remove') {
        throw new ApiError(400, 'action must be "add" or "remove"', 'bad_request');
      }
      if (!label || typeof label !== 'string') {
        throw new ApiError(400, 'label must be a non-empty string', 'bad_request');
      }

      const gmail = getGmailService();
      const messages = await gmail.getMessages();
      const labelsResource = await gmail.getLabels();

      // Find label by name
      const listResponse = await labelsResource.list({ userId: 'me' });
      const existingLabels = listResponse.data.labels ?? [];
      let labelInfo = existingLabels.find(
        (l) => l.name?.toLowerCase() === label.toLowerCase()
      );

      if (!labelInfo && action === 'add' && create) {
        const createResponse = await labelsResource.create({
          userId: 'me',
          requestBody: {
            name: label,
            labelListVisibility: 'labelShow',
            messageListVisibility: 'show',
          },
        });
        labelInfo = createResponse.data;
      }

      if (!labelInfo || !labelInfo.id) {
        throw new ApiError(404, `Label "${label}" not found`, 'label_not_found');
      }

      let success = 0;
      let failed = 0;

      const body =
        action === 'add'
          ? { addLabelIds: [labelInfo.id] }
          : { removeLabelIds: [labelInfo.id] };

      for (const id of messageIds) {
        try {
          await messages.modify({ userId: 'me', id, requestBody: body });
          success++;
        } catch {
          failed++;
        }
      }

      res.json({
        success,
        failed,
        total: messageIds.length,
        labelId: labelInfo.id,
        labelName: labelInfo.name,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
