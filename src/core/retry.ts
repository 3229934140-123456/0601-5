export class RetryUtil {
  static async execute<T>(
    fn: () => Promise<T>,
    options: {
      maxRetries?: number;
      delay?: number;
      shouldRetry?: (error: Error, attempt: number) => boolean;
      onRetry?: (error: Error, attempt: number) => void;
    } = {}
  ): Promise<T> {
    const {
      maxRetries = 3,
      delay = 1000,
      shouldRetry = () => true,
      onRetry,
    } = options;

    let lastError: Error;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (attempt === maxRetries || !shouldRetry(lastError, attempt + 1)) {
          throw lastError;
        }

        if (onRetry) {
          onRetry(lastError, attempt + 1);
        }

        const waitTime = delay * Math.pow(2, attempt);
        await this.sleep(waitTime);
      }
    }

    throw lastError!;
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  static isRetryableError(error: Error): boolean {
    const retryableStatuses = [408, 429, 500, 502, 503, 504];
    const errorMessage = error.message.toLowerCase();

    if (error.name === 'TimeoutError') return true;
    if (error.name === 'NetworkError') return true;

    for (const status of retryableStatuses) {
      if (errorMessage.includes(`status ${status}`)) {
        return true;
      }
    }

    if (errorMessage.includes('timeout')) return true;
    if (errorMessage.includes('rate limit')) return true;
    if (errorMessage.includes('too many requests')) return true;
    if (errorMessage.includes('connection')) return true;

    return false;
  }
}
