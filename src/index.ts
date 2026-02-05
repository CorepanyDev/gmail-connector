#!/usr/bin/env node

/**
 * Gmail Connector CLI
 * A tool to manage Gmail accounts - organize, clean up, and analyze emails
 */

import { run } from './cli';

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
