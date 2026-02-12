# Gmail Connector REST API

REST API for managing Gmail, Google Calendar, and Google Tasks.

## Setup

### 1. Prerequisites

- Node.js >= 18
- Google OAuth credentials configured (`credentials.json` + `token.json`)
- Authenticate first: `gmail-connector auth login`

### 2. Generate an API Key

```bash
export API_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo $API_KEY  # save this somewhere safe
```

### 3. Start the Server

```bash
# Direct
gmail-connector serve --port 3030 --api-key $API_KEY

# Or via PM2
API_KEY=$API_KEY API_PORT=3030 pm2 start ecosystem.config.js --only gmail-connector-api
```

### 4. Verify

```bash
curl http://localhost:3030/api/health
# → {"status":"ok","timestamp":"..."}
```

## Authentication

All endpoints except `/api/health` require a Bearer token:

```
Authorization: Bearer <API_KEY>
```

Requests without a valid token receive `401`:

```json
{"error": {"code": "unauthorized", "message": "Missing or invalid Authorization header", "status": 401}}
```

## Endpoints

### Health & Auth

#### `GET /api/health`

Health check. **No authentication required.**

```bash
curl http://localhost:3030/api/health
```

```json
{"status": "ok", "timestamp": "2026-01-15T10:00:00.000Z"}
```

#### `GET /api/auth/status`

Check Google OAuth status and profile info.

```bash
curl -H "Authorization: Bearer $API_KEY" http://localhost:3030/api/auth/status
```

```json
{
  "authenticated": true,
  "email": "user@gmail.com",
  "messagesTotal": 12450,
  "threadsTotal": 8320
}
```

---

### Gmail Messages

#### `GET /api/gmail/messages`

List inbox messages.

| Parameter   | Type   | Default | Description              |
|-------------|--------|---------|--------------------------|
| `limit`     | number | 20      | Number of messages (1-500) |
| `pageToken` | string | —       | Pagination token         |

```bash
curl -H "Authorization: Bearer $API_KEY" "http://localhost:3030/api/gmail/messages?limit=5"
```

```json
{
  "emails": [
    {
      "id": "18abc123",
      "date": "Wed, 15 Jan 2026 10:30:00 +0000",
      "from": "sender@example.com",
      "subject": "Hello",
      "snippet": "Preview text..."
    }
  ],
  "nextPageToken": "token123",
  "resultSizeEstimate": 150
}
```

#### `GET /api/gmail/messages/search`

Search messages with Gmail query syntax.

| Parameter       | Type    | Default | Description                    |
|-----------------|---------|---------|--------------------------------|
| `q`             | string  | —       | Gmail search query             |
| `from`          | string  | —       | Filter by sender               |
| `to`            | string  | —       | Filter by recipient            |
| `subject`       | string  | —       | Filter by subject              |
| `hasAttachment` | boolean | false   | Only emails with attachments   |
| `limit`         | number  | 20      | Number of messages (1-500)     |
| `pageToken`     | string  | —       | Pagination token               |
| `all`           | boolean | false   | Search all mail (not just inbox) |

```bash
curl -H "Authorization: Bearer $API_KEY" \
  "http://localhost:3030/api/gmail/messages/search?from=github.com&limit=3"
```

```json
{
  "query": "in:inbox from:github.com",
  "emails": [...],
  "count": 3,
  "nextPageToken": "...",
  "resultSizeEstimate": 42
}
```

#### `GET /api/gmail/messages/:id`

Get full message detail.

| Parameter | Type    | Default | Description            |
|-----------|---------|---------|------------------------|
| `full`    | boolean | false   | Include full body text |

```bash
curl -H "Authorization: Bearer $API_KEY" \
  "http://localhost:3030/api/gmail/messages/18abc123?full=true"
```

```json
{
  "id": "18abc123",
  "threadId": "18abc100",
  "from": "sender@example.com",
  "to": "you@gmail.com",
  "cc": "",
  "date": "Wed, 15 Jan 2026 10:30:00 +0000",
  "subject": "Hello",
  "snippet": "Preview...",
  "labels": ["INBOX", "UNREAD"],
  "sizeEstimate": 5432,
  "body": "Full message body text...",
  "bodyHtml": "<html>...</html>",
  "attachments": []
}
```

#### `GET /api/gmail/messages/:id/attachments`

List attachments for a message.

```bash
curl -H "Authorization: Bearer $API_KEY" \
  http://localhost:3030/api/gmail/messages/18abc123/attachments
```

```json
{
  "attachments": [
    {
      "filename": "report.pdf",
      "mimeType": "application/pdf",
      "size": 102400,
      "attachmentId": "att_abc123"
    }
  ]
}
```

#### `POST /api/gmail/messages/archive`

Archive messages (remove from inbox).

```bash
curl -X POST -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messageIds": ["id1", "id2"]}' \
  http://localhost:3030/api/gmail/messages/archive
```

```json
{"success": 2, "failed": 0, "total": 2}
```

#### `POST /api/gmail/messages/trash`

Move messages to trash.

```bash
curl -X POST -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messageIds": ["id1"]}' \
  http://localhost:3030/api/gmail/messages/trash
```

```json
{"success": 1, "failed": 0, "total": 1}
```

#### `POST /api/gmail/messages/mark`

Mark messages as read or unread.

| Body Field   | Type     | Required | Description          |
|--------------|----------|----------|----------------------|
| `messageIds` | string[] | yes      | Message IDs          |
| `action`     | string   | yes      | `"read"` or `"unread"` |

```bash
curl -X POST -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messageIds": ["id1", "id2"], "action": "read"}' \
  http://localhost:3030/api/gmail/messages/mark
```

```json
{"success": 2, "failed": 0, "total": 2}
```

#### `POST /api/gmail/messages/label`

Add or remove a label from messages.

| Body Field   | Type     | Required | Description                     |
|--------------|----------|----------|---------------------------------|
| `messageIds` | string[] | yes      | Message IDs                     |
| `action`     | string   | yes      | `"add"` or `"remove"`          |
| `label`      | string   | yes      | Label name                      |
| `create`     | boolean  | no       | Create label if it doesn't exist |

```bash
curl -X POST -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messageIds": ["id1"], "action": "add", "label": "Important", "create": true}' \
  http://localhost:3030/api/gmail/messages/label
```

```json
{"success": 1, "failed": 0, "total": 1, "labelId": "Label_123", "labelName": "Important"}
```

---

### Gmail Labels

#### `GET /api/gmail/labels`

List all labels.

```bash
curl -H "Authorization: Bearer $API_KEY" http://localhost:3030/api/gmail/labels
```

```json
{
  "labels": [
    {"id": "INBOX", "name": "INBOX", "type": "system", "messageCount": 150},
    {"id": "Label_1", "name": "Projects", "type": "user", "messageCount": 42}
  ],
  "systemCount": 15,
  "userCount": 8,
  "totalCount": 23
}
```

#### `POST /api/gmail/labels`

Create a new label.

| Body Field   | Type   | Required | Description                                   |
|--------------|--------|----------|-----------------------------------------------|
| `name`       | string | yes      | Label name                                    |
| `color`      | object | no       | `{backgroundColor: "#hex", textColor: "#hex"}` |
| `visibility` | object | no       | `{list: "show"\|"hide", message: "show"\|"hide"}` |

```bash
curl -X POST -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Receipts", "color": {"backgroundColor": "#149e60", "textColor": "#ffffff"}}' \
  http://localhost:3030/api/gmail/labels
```

```json
{"id": "Label_456", "name": "Receipts", "color": {"backgroundColor": "#149e60", "textColor": "#ffffff"}}
```

---

### Gmail Stats

#### `GET /api/gmail/stats`

Inbox health metrics and summary statistics.

```bash
curl -H "Authorization: Bearer $API_KEY" http://localhost:3030/api/gmail/stats
```

```json
{
  "overview": {
    "totalEmails": 12450,
    "unreadCount": 234,
    "inboxCount": 1520,
    "inboxUnread": 89,
    "spamCount": 12,
    "trashCount": 45
  },
  "topSenders": [
    {"email": "notifications@github.com", "count": 28}
  ],
  "ageDistribution": [
    {"bucket": "Today", "count": 15, "percentage": "7.5"},
    {"bucket": "This Week", "count": 45, "percentage": "22.5"},
    {"bucket": "This Month", "count": 80, "percentage": "40.0"},
    {"bucket": "Older", "count": 60, "percentage": "30.0"}
  ],
  "newsletters": {"count": 42, "percentage": "21.0"},
  "storage": {"averageEmailSize": 15360, "estimatedTotal": 191232000},
  "sampleInfo": {"emailsSampled": 200}
}
```

---

### Calendar

#### `GET /api/calendars`

List all calendars.

```bash
curl -H "Authorization: Bearer $API_KEY" http://localhost:3030/api/calendars
```

```json
{
  "calendars": [
    {"id": "primary", "summary": "My Calendar", "timeZone": "Europe/Istanbul", "primary": true},
    {"id": "abc@group.calendar.google.com", "summary": "Work", "primary": false}
  ]
}
```

#### `GET /api/calendars/:calendarId/events`

List events from a calendar.

| Parameter | Type   | Default       | Description         |
|-----------|--------|---------------|---------------------|
| `from`    | string | now           | Start time (ISO 8601) |
| `to`      | string | —             | End time (ISO 8601) |
| `limit`   | number | 25            | Max events          |
| `query`   | string | —             | Free-text search    |

```bash
curl -H "Authorization: Bearer $API_KEY" \
  "http://localhost:3030/api/calendars/primary/events?limit=5"
```

```json
{
  "events": [
    {
      "id": "evt_123",
      "summary": "Team Standup",
      "start": "2026-01-15T09:00:00+03:00",
      "end": "2026-01-15T09:30:00+03:00",
      "location": "Zoom",
      "status": "confirmed"
    }
  ]
}
```

#### `POST /api/calendars/:calendarId/events`

Create an event.

| Body Field    | Type    | Required | Description          |
|---------------|---------|----------|----------------------|
| `summary`     | string  | yes      | Event title          |
| `start`       | string  | yes      | Start time (ISO 8601) or date (YYYY-MM-DD for all-day) |
| `end`         | string  | yes      | End time             |
| `description` | string  | no       | Event description    |
| `location`    | string  | no       | Location             |
| `allDay`      | boolean | no       | All-day event        |
| `reminders`   | object  | no       | `{minutes: 10}`      |

```bash
curl -X POST -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "summary": "Lunch",
    "start": "2026-01-15T12:00:00+03:00",
    "end": "2026-01-15T13:00:00+03:00",
    "location": "Cafe"
  }' \
  http://localhost:3030/api/calendars/primary/events
```

#### `PATCH /api/calendars/:calendarId/events/:eventId`

Update an event. Only include fields you want to change.

```bash
curl -X PATCH -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"summary": "Updated Title", "location": "New Place"}' \
  http://localhost:3030/api/calendars/primary/events/evt_123
```

#### `DELETE /api/calendars/:calendarId/events/:eventId`

Delete an event. Returns `204 No Content`.

```bash
curl -X DELETE -H "Authorization: Bearer $API_KEY" \
  http://localhost:3030/api/calendars/primary/events/evt_123
```

---

### Tasks

#### `GET /api/tasks/lists`

List all task lists.

```bash
curl -H "Authorization: Bearer $API_KEY" http://localhost:3030/api/tasks/lists
```

```json
{
  "taskLists": [
    {"id": "MTIzNDU2", "title": "My Tasks", "updated": "2026-01-15T10:00:00.000Z"}
  ]
}
```

#### `GET /api/tasks/lists/:listId/tasks`

List tasks in a list. Use `@default` for the default list.

| Parameter       | Type    | Default | Description              |
|-----------------|---------|---------|--------------------------|
| `showCompleted` | boolean | false   | Include completed tasks  |
| `dueBefore`     | string  | —       | Filter by due date (ISO 8601) |

```bash
curl -H "Authorization: Bearer $API_KEY" \
  "http://localhost:3030/api/tasks/lists/@default/tasks?showCompleted=true"
```

```json
{
  "tasks": [
    {
      "id": "task_abc",
      "title": "Buy groceries",
      "status": "needsAction",
      "due": "2026-01-16T00:00:00.000Z",
      "updated": "2026-01-15T10:00:00.000Z",
      "position": "00000000000000000000"
    }
  ]
}
```

#### `POST /api/tasks/lists/:listId/tasks`

Create a task.

| Body Field | Type   | Required | Description       |
|------------|--------|----------|-------------------|
| `title`    | string | yes      | Task title        |
| `notes`    | string | no       | Task description  |
| `due`      | string | no       | Due date (ISO 8601) |

```bash
curl -X POST -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title": "Review PR", "due": "2026-01-16"}' \
  http://localhost:3030/api/tasks/lists/@default/tasks
```

#### `PATCH /api/tasks/lists/:listId/tasks/:taskId`

Update a task. Only include fields you want to change.

| Body Field | Type   | Description       |
|------------|--------|-------------------|
| `title`    | string | New title         |
| `notes`    | string | New notes         |
| `due`      | string | New due date      |
| `status`   | string | `"needsAction"` or `"completed"` |

```bash
curl -X PATCH -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title": "Review PR (urgent)"}' \
  http://localhost:3030/api/tasks/lists/@default/tasks/task_abc
```

#### `POST /api/tasks/lists/:listId/tasks/:taskId/complete`

Mark a task as completed.

```bash
curl -X POST -H "Authorization: Bearer $API_KEY" \
  http://localhost:3030/api/tasks/lists/@default/tasks/task_abc/complete
```

#### `DELETE /api/tasks/lists/:listId/tasks/:taskId`

Delete a task. Returns `204 No Content`.

```bash
curl -X DELETE -H "Authorization: Bearer $API_KEY" \
  http://localhost:3030/api/tasks/lists/@default/tasks/task_abc
```

---

## Error Responses

All errors return a consistent JSON format:

```json
{
  "error": {
    "code": "error_code",
    "message": "Human-readable message",
    "status": 400
  }
}
```

| Status | Code                | When                              |
|--------|---------------------|-----------------------------------|
| 400    | `bad_request`       | Missing or invalid parameters     |
| 401    | `unauthorized`      | Missing/invalid API key or OAuth  |
| 404    | `label_not_found`   | Label doesn't exist               |
| 404    | `google_api_error`  | Resource not found in Google API  |
| 500    | `service_error`     | Service initialization failure    |
| 500    | `internal_error`    | Unexpected server error           |
