export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

// Browsers report this diagnostic through window.onerror when a
// ResizeObserver needs one more frame to deliver layout notifications. It is
// not an application failure and is especially common during drag-resizing.
export function isResizeObserverLoopError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : '';

  return /^ResizeObserver loop (?:limit exceeded|completed with undelivered notifications\.?)$/i.test(message.trim());
}
