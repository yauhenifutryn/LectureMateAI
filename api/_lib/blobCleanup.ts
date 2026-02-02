import { deleteObjects } from './gcs.js';

type CleanupLogger = {
  error: (...args: unknown[]) => void;
};

export async function cleanupBlobUrls(
  urls: string[],
  logger: CleanupLogger = console
): Promise<void> {
  for (const url of urls) {
    try {
      await deleteObjects([url]);
    } catch (error) {
      logger.error('Blob cleanup failed:', url, error);
    }
  }
}
