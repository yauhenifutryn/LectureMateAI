export function validateBlobUrl(fileUrl: string, allowedPrefix?: string): URL {
  let url: URL;
  try {
    url = new URL(fileUrl);
  } catch {
    throw new Error('Invalid blob URL.');
  }

  if (!url.hostname.endsWith('.blob.vercel-storage.com')) {
    throw new Error('Invalid blob host.');
  }

  if (allowedPrefix && !fileUrl.startsWith(allowedPrefix)) {
    throw new Error('Invalid blob prefix.');
  }

  return url;
}
