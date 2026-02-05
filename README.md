# Gmail Connector

A CLI tool to manage Gmail accounts - organize, clean up, and analyze emails.

## Features

- **List & Search**: Browse and search emails with Gmail query syntax
- **Organize**: Apply labels, archive, mark read/unread, trash emails
- **Analyze**: Analyze inbox by sender, detect newsletters, view statistics
- **Cleanup**: Find large emails, old emails, and manage storage
- **Sync**: Cache emails locally for faster analysis
- **Unsubscribe**: Find and track newsletter unsubscriptions

## Installation

```bash
npm install
npm run build
npm link  # Makes 'gmail-connector' available globally
```

## Setup

1. Create a Google Cloud project and enable the Gmail API
2. Create OAuth 2.0 credentials (Desktop application type)
3. Download the credentials JSON and save as `credentials.json`
4. Run `gmail-connector auth login` to authenticate

## Usage

```bash
# Authentication
gmail-connector auth login      # Authenticate with Gmail
gmail-connector auth status     # Check authentication status
gmail-connector auth logout     # Clear saved tokens

# List and search emails
gmail-connector list                    # List recent emails
gmail-connector list --limit 50         # List more emails
gmail-connector search "from:github"    # Search with Gmail syntax
gmail-connector get <message-id>        # Get email details

# Organize emails
gmail-connector label add Important --query "from:boss@work.com"
gmail-connector archive --query "older_than:1y"
gmail-connector mark read --query "is:unread category:promotions"
gmail-connector trash --query "larger:10M older_than:6m"

# Labels
gmail-connector labels list             # List all labels
gmail-connector labels create "Project" --color blue

# Analysis
gmail-connector stats                   # Inbox health report
gmail-connector analyze senders         # Top senders by volume
gmail-connector analyze newsletters     # Detect subscriptions

# Cleanup
gmail-connector cleanup large --larger-than 10MB
gmail-connector cleanup old --older-than 2y

# Sync
gmail-connector sync                    # Sync emails to local cache
gmail-connector sync --full             # Force full resync

# Unsubscribe
gmail-connector unsubscribe noreply@newsletter.com --open
```

## PM2 Scheduled Tasks

The Gmail Connector includes PM2 configuration for running scheduled background tasks.

### Prerequisites

Install PM2 globally:

```bash
npm install -g pm2
```

### Starting Scheduled Jobs

```bash
# Start all scheduled jobs
pm2 start ecosystem.config.js

# View running jobs
pm2 list

# View logs
pm2 logs

# Stop all jobs
pm2 stop all

# Delete all jobs
pm2 delete all
```

### Configured Jobs

| Job Name | Schedule | Description |
|----------|----------|-------------|
| `gmail-connector-sync` | Daily at 6:00 AM | Sync emails to local cache |
| `gmail-connector-report` | Monday at 9:00 AM | Generate weekly inbox stats |
| `gmail-connector-newsletters` | Sunday at 8:00 PM | Analyze newsletter subscriptions |

### Environment Variables

Configure jobs using environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `GMAIL_CREDENTIALS_PATH` | `./credentials.json` | Path to OAuth credentials |
| `GMAIL_TOKEN_PATH` | `./token.json` | Path to saved tokens |
| `GMAIL_CACHE_PATH` | `~/.gmail-connector/cache.db` | Path to SQLite cache |
| `GMAIL_VERBOSE` | `false` | Enable verbose logging |
| `GMAIL_LOG_DIR` | `./logs` | Directory for PM2 logs |

Example:

```bash
GMAIL_CREDENTIALS_PATH=/secure/creds.json pm2 start ecosystem.config.js
```

### Log Rotation

PM2 logs are automatically rotated:
- Maximum file size: 10MB
- Retention: 7 days
- Log location: `./logs/` directory

To set up PM2 log rotation:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

### Persisting Jobs Across Reboots

```bash
# Save current PM2 configuration
pm2 save

# Set PM2 to start on system boot
pm2 startup
```

### Customizing Schedules

Edit `ecosystem.config.js` to change schedules. The `cron_restart` field uses standard cron syntax:

```
*    *    *    *    *
|    |    |    |    |
|    |    |    |    └─ day of week (0-7, Sun=0 or 7)
|    |    |    └────── month (1-12)
|    |    └─────────── day of month (1-31)
|    └──────────────── hour (0-23)
└───────────────────── minute (0-59)
```

Examples:
- `0 6 * * *` - Every day at 6:00 AM
- `0 9 * * 1` - Every Monday at 9:00 AM
- `0 */4 * * *` - Every 4 hours
- `30 8 1 * *` - 8:30 AM on the 1st of every month

## Global Options

All commands support:
- `--verbose` - Enable detailed output
- `--config <path>` - Use custom credentials file path
- `--json` - Output in JSON format (where applicable)

## License

MIT
