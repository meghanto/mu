/**
 * Safely formats an error for logging or display
 * Handles Error instances, strings, and unknown types
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return String(error);
}

/**
 * Formats an error with its stack trace (for debugging)
 */
export function formatErrorWithStack(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return formatError(error);
}
