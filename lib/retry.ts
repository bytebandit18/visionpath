export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  attempts = Number(process.env.RETRY_ATTEMPTS || 6),
  baseDelay = Number(process.env.RETRY_BASE_DELAY || 800)
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const msg = String(err?.status || err?.statusCode || err?.message || err || '');
      const isRate = (err?.status === 429) || /rate limit|quota|429/i.test(msg);

      // If we've exhausted attempts, rethrow the error
      if (i === attempts - 1) throw err;

      // Don't retry on client errors that are not rate/quota related
      if (err?.status && err.status >= 400 && err.status < 500 && !isRate) {
        throw err;
      }

      // Exponential backoff with jitter
      // Cap exponential growth to avoid extremely long waits
      const jitter = Math.random() * Math.min(200, baseDelay * 0.25);
      const rawDelay = baseDelay * Math.pow(2, i);
      const maxDelay = Number(process.env.RETRY_MAX_DELAY || 30000);
      const delay = Math.min(rawDelay, maxDelay) + jitter;
      await new Promise((res) => setTimeout(res, delay));
    }
  }

  // Shouldn't reach here
  throw new Error('retryWithBackoff: attempts exhausted');
}
