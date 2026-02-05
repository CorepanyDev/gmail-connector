/**
 * PM2 Ecosystem Configuration for Gmail Connector
 *
 * This configuration enables scheduled background tasks for automated
 * email management including daily sync and weekly cleanup reports.
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 stop gmail-connector-sync
 *   pm2 logs gmail-connector-sync
 *   pm2 delete all
 *
 * Environment Variables:
 *   GMAIL_CREDENTIALS_PATH - Path to credentials.json (default: ./credentials.json)
 *   GMAIL_TOKEN_PATH - Path to token.json (default: ./token.json)
 *   GMAIL_CACHE_PATH - Path to cache database (default: ~/.gmail-connector/cache.db)
 *   GMAIL_VERBOSE - Enable verbose output (default: false)
 *   GMAIL_LOG_DIR - Directory for PM2 logs (default: ./logs)
 */

const path = require('path');

// Environment configuration with defaults
const LOG_DIR = process.env.GMAIL_LOG_DIR || path.join(__dirname, 'logs');
const CREDENTIALS_PATH = process.env.GMAIL_CREDENTIALS_PATH || './credentials.json';
const VERBOSE = process.env.GMAIL_VERBOSE === 'true';

// Common environment variables passed to all jobs
const commonEnv = {
  NODE_ENV: 'production',
  GMAIL_CREDENTIALS_PATH: CREDENTIALS_PATH,
  GMAIL_TOKEN_PATH: process.env.GMAIL_TOKEN_PATH || './token.json',
  GMAIL_CACHE_PATH: process.env.GMAIL_CACHE_PATH || '',
};

module.exports = {
  apps: [
    {
      // Daily Sync Job
      // Runs every day at 6 AM to sync emails to local cache
      name: 'gmail-connector-sync',
      script: 'dist/index.js',
      args: VERBOSE ? 'sync --verbose' : 'sync',
      cwd: __dirname,
      cron_restart: '0 6 * * *', // Every day at 6:00 AM
      autorestart: false, // Don't auto-restart on exit (cron handles scheduling)
      watch: false,
      env: {
        ...commonEnv,
      },
      // Log configuration
      output: path.join(LOG_DIR, 'sync-out.log'),
      error: path.join(LOG_DIR, 'sync-error.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      // Log rotation - keep logs for 7 days, max 10MB per file
      log_type: 'json',
      max_size: '10M',
      retain: 7,
    },
    {
      // Weekly Cleanup Report Job
      // Runs every Monday at 9 AM to generate inbox health report
      name: 'gmail-connector-report',
      script: 'dist/index.js',
      args: 'stats',
      cwd: __dirname,
      cron_restart: '0 9 * * 1', // Every Monday at 9:00 AM
      autorestart: false,
      watch: false,
      env: {
        ...commonEnv,
      },
      // Log configuration
      output: path.join(LOG_DIR, 'report-out.log'),
      error: path.join(LOG_DIR, 'report-error.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_size: '10M',
      retain: 7,
    },
    {
      // Weekly Newsletter Analysis Job
      // Runs every Sunday at 8 PM to analyze newsletter subscriptions
      name: 'gmail-connector-newsletters',
      script: 'dist/index.js',
      args: 'analyze newsletters --since 7d',
      cwd: __dirname,
      cron_restart: '0 20 * * 0', // Every Sunday at 8:00 PM
      autorestart: false,
      watch: false,
      env: {
        ...commonEnv,
      },
      // Log configuration
      output: path.join(LOG_DIR, 'newsletters-out.log'),
      error: path.join(LOG_DIR, 'newsletters-error.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_size: '10M',
      retain: 7,
    },
  ],

  // PM2 deploy configuration (optional, for remote deployment)
  deploy: {
    production: {
      user: 'node',
      host: 'your-server.com',
      ref: 'origin/main',
      repo: 'git@github.com:username/gmail-connector.git',
      path: '/var/www/gmail-connector',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env production',
    },
  },
};
