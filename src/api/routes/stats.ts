import { Router } from 'express';
import type { gmail_v1 } from 'googleapis';
import { getGmailService } from '../../gmail';

function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string {
  if (!headers) return '';
  const header = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return header?.value ?? '';
}

function extractEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1].toLowerCase() : from.toLowerCase().trim();
}

export function createStatsRoutes(): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      const gmail = getGmailService();
      const messagesApi = await gmail.getMessages();
      const labelsApi = await gmail.getLabels();

      // Get inbox counts
      const inboxLabel = await labelsApi.get({ userId: 'me', id: 'INBOX' });
      const inboxCount = inboxLabel.data.messagesTotal ?? 0;
      const inboxUnread = inboxLabel.data.messagesUnread ?? 0;

      // Total emails estimate
      let totalEmails = inboxCount;
      try {
        const allMailResponse = await messagesApi.list({
          userId: 'me',
          maxResults: 1,
          includeSpamTrash: true,
        });
        totalEmails = allMailResponse.data.resultSizeEstimate ?? inboxCount;
      } catch { /* fallback */ }

      // Unread count
      let totalUnread = inboxUnread;
      try {
        const unreadLabel = await labelsApi.get({ userId: 'me', id: 'UNREAD' });
        totalUnread = unreadLabel.data.messagesTotal ?? inboxUnread;
      } catch { /* fallback */ }

      // Spam + trash
      let spamCount = 0;
      let trashCount = 0;
      try {
        const spamLabel = await labelsApi.get({ userId: 'me', id: 'SPAM' });
        spamCount = spamLabel.data.messagesTotal ?? 0;
      } catch { /* ignore */ }
      try {
        const trashLabel = await labelsApi.get({ userId: 'me', id: 'TRASH' });
        trashCount = trashLabel.data.messagesTotal ?? 0;
      } catch { /* ignore */ }

      // Sample recent emails for age distribution and top senders
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const ageBuckets = [
        { label: 'Today', count: 0 },
        { label: 'This Week', count: 0 },
        { label: 'This Month', count: 0 },
        { label: 'Older', count: 0 },
      ];

      const senderMap = new Map<string, number>();
      let newsletterCount = 0;
      let totalSize = 0;
      let sampledCount = 0;
      let pageToken: string | undefined;
      const sampleSize = 200; // lighter than CLI for API response speed

      do {
        const listResponse = await messagesApi.list({
          userId: 'me',
          maxResults: Math.min(100, sampleSize - sampledCount),
          pageToken,
          labelIds: ['INBOX'],
        });

        const messages = listResponse.data.messages ?? [];
        pageToken = listResponse.data.nextPageToken ?? undefined;
        if (messages.length === 0) break;

        const details = await Promise.all(
          messages.map(async (msg) => {
            if (!msg.id) return null;
            try {
              const r = await messagesApi.get({
                userId: 'me',
                id: msg.id,
                format: 'metadata',
                metadataHeaders: ['From', 'Date', 'List-Unsubscribe'],
              });
              return r.data;
            } catch {
              return null;
            }
          })
        );

        for (const msgData of details) {
          if (!msgData) continue;
          sampledCount++;
          const headers = msgData.payload?.headers;
          const fromRaw = getHeader(headers, 'From');
          const dateStr = getHeader(headers, 'Date');
          const listUnsub = getHeader(headers, 'List-Unsubscribe');
          const size = msgData.sizeEstimate ?? 0;
          totalSize += size;

          if (listUnsub) newsletterCount++;

          const date = new Date(dateStr);
          if (!isNaN(date.getTime())) {
            if (date >= todayStart) ageBuckets[0].count++;
            else if (date >= weekAgo) ageBuckets[1].count++;
            else if (date >= monthAgo) ageBuckets[2].count++;
            else ageBuckets[3].count++;
          }

          if (fromRaw) {
            const email = extractEmail(fromRaw);
            senderMap.set(email, (senderMap.get(email) ?? 0) + 1);
          }
        }
      } while (pageToken && sampledCount < sampleSize);

      const topSenders = Array.from(senderMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([email, count]) => ({ email, count }));

      const avgSize = sampledCount > 0 ? Math.round(totalSize / sampledCount) : 0;

      res.json({
        overview: {
          totalEmails,
          unreadCount: totalUnread,
          inboxCount,
          inboxUnread,
          spamCount,
          trashCount,
        },
        topSenders,
        ageDistribution: ageBuckets.map((b) => ({
          bucket: b.label,
          count: b.count,
          percentage: sampledCount > 0 ? ((b.count / sampledCount) * 100).toFixed(1) : '0',
        })),
        newsletters: {
          count: newsletterCount,
          percentage: sampledCount > 0 ? ((newsletterCount / sampledCount) * 100).toFixed(1) : '0',
        },
        storage: {
          averageEmailSize: avgSize,
          estimatedTotal: avgSize * totalEmails,
        },
        sampleInfo: {
          emailsSampled: sampledCount,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
