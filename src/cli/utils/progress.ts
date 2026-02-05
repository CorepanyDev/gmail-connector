/**
 * Progress bar utilities for bulk operations
 * Uses cli-progress library with graceful fallback for non-TTY environments
 */

import * as cliProgress from 'cli-progress';

/**
 * Progress bar interface for bulk operations
 */
export interface ProgressBar {
  /** Start the progress bar with total count */
  start(total: number, message?: string): void;
  /** Update progress to current value */
  update(current: number, message?: string): void;
  /** Increment progress by value (default 1) */
  increment(value?: number): void;
  /** Stop the progress bar and show completion message */
  stop(message?: string): void;
  /** Check if progress bar is active */
  isActive(): boolean;
}

/**
 * Options for creating a progress bar
 */
export interface ProgressBarOptions {
  /** Enable verbose mode for additional logging */
  verbose?: boolean;
  /** Minimum items to show progress (default: 20) */
  threshold?: number;
  /** Bar width in characters (default: 30) */
  barWidth?: number;
  /** Show ETA (default: true) */
  showEta?: boolean;
  /** Custom format string */
  format?: string;
}

/**
 * Create a progress bar for bulk operations
 * Uses cli-progress for TTY environments, falls back to simple console output otherwise
 */
export function createProgressBar(options: ProgressBarOptions = {}): ProgressBar {
  const {
    verbose = false,
    threshold = 20,
    barWidth = 30,
    showEta = true,
  } = options;

  // Check if terminal supports progress bar
  const isTTY = process.stdout.isTTY;

  let bar: cliProgress.SingleBar | null = null;
  let total = 0;
  let current = 0;
  let active = false;
  let currentMessage = '';
  let belowThreshold = false;

  // Custom format for the progress bar
  const format = options.format || (
    showEta
      ? '{bar} {percentage}% | {value}/{total} | ETA: {eta_formatted} | {message}'
      : '{bar} {percentage}% | {value}/{total} | {message}'
  );

  return {
    start(totalCount: number, message?: string): void {
      total = totalCount;
      current = 0;
      currentMessage = message || '';
      belowThreshold = total < threshold;

      // Don't show progress bar for small operations
      if (belowThreshold) {
        if (verbose && message) {
          console.log(message);
        }
        active = true;
        return;
      }

      // Create progress bar for TTY environments
      if (isTTY) {
        bar = new cliProgress.SingleBar({
          format,
          barCompleteChar: '█',
          barIncompleteChar: '░',
          hideCursor: true,
          clearOnComplete: true,
          barsize: barWidth,
          etaBuffer: 30,
        }, cliProgress.Presets.shades_classic);

        bar.start(total, 0, { message: currentMessage });
        active = true;
      } else {
        // Non-TTY fallback: just log the start message
        if (message) {
          console.log(message);
        }
        active = true;
      }
    },

    update(currentValue: number, message?: string): void {
      current = currentValue;
      if (message !== undefined) {
        currentMessage = message;
      }

      if (belowThreshold) {
        return;
      }

      if (bar) {
        bar.update(current, { message: currentMessage });
      } else if (!isTTY && verbose) {
        // Non-TTY verbose fallback: log every 10%
        const percent = Math.floor((current / total) * 100);
        if (percent % 10 === 0) {
          console.log(`  Progress: ${current}/${total} (${percent}%)${currentMessage ? ` - ${currentMessage}` : ''}`);
        }
      }
    },

    increment(value: number = 1): void {
      this.update(current + value);
    },

    stop(message?: string): void {
      if (!active) return;

      if (bar) {
        bar.stop();
        bar = null;
      }

      if (message && !belowThreshold) {
        console.log(message);
      }

      active = false;
      belowThreshold = false;
    },

    isActive(): boolean {
      return active;
    },
  };
}

/**
 * Create a spinner for indeterminate progress
 * Uses ora-style animation for TTY, simple dots for non-TTY
 */
export interface Spinner {
  /** Start the spinner with a message */
  start(message: string): void;
  /** Update the spinner message */
  update(message: string): void;
  /** Stop with success message */
  succeed(message?: string): void;
  /** Stop with failure message */
  fail(message?: string): void;
  /** Stop spinner (neutral) */
  stop(): void;
}

/**
 * Create a simple text-based spinner
 */
export function createSpinner(): Spinner {
  const isTTY = process.stdout.isTTY;
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frameIndex = 0;
  let intervalId: NodeJS.Timeout | null = null;
  let currentMessage = '';

  return {
    start(message: string): void {
      currentMessage = message;

      if (isTTY) {
        intervalId = setInterval(() => {
          const frame = frames[frameIndex];
          process.stdout.write(`\r${frame} ${currentMessage}`);
          frameIndex = (frameIndex + 1) % frames.length;
        }, 80);
      } else {
        console.log(`... ${message}`);
      }
    },

    update(message: string): void {
      currentMessage = message;
      if (!isTTY) {
        console.log(`... ${message}`);
      }
    },

    succeed(message?: string): void {
      this.stop();
      const msg = message || currentMessage;
      console.log(`✓ ${msg}`);
    },

    fail(message?: string): void {
      this.stop();
      const msg = message || currentMessage;
      console.log(`✗ ${msg}`);
    },

    stop(): void {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        // Clear the spinner line
        if (process.stdout.isTTY) {
          process.stdout.write('\r' + ' '.repeat(currentMessage.length + 10) + '\r');
        }
      }
    },
  };
}

/**
 * Helper to run a bulk operation with progress tracking
 */
export async function withProgress<T>(
  items: T[],
  operation: (item: T, index: number) => Promise<void>,
  options: ProgressBarOptions & {
    batchSize?: number;
    message?: string;
    completionMessage?: (success: number, failed: number) => string;
  } = {}
): Promise<{ success: number; failed: number }> {
  const { batchSize = 10, message, completionMessage } = options;
  const progress = createProgressBar(options);

  let success = 0;
  let failed = 0;

  progress.start(items.length, message);

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    const results = await Promise.all(
      batch.map(async (item, batchIndex) => {
        try {
          await operation(item, i + batchIndex);
          return true;
        } catch {
          return false;
        }
      })
    );

    success += results.filter(Boolean).length;
    failed += results.filter((r) => !r).length;
    progress.update(Math.min(i + batchSize, items.length));
  }

  const finalMessage = completionMessage
    ? completionMessage(success, failed)
    : `Completed: ${success} succeeded, ${failed} failed`;

  progress.stop(finalMessage);

  return { success, failed };
}
