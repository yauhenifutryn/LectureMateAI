import type { VercelRequest, VercelResponse } from '@vercel/node';

export async function buildVercelRequest(req: Request) {
  const url = new URL(req.url);
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  let body: unknown = undefined;
  const contentType = req.headers.get('content-type') || '';
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (contentType.includes('application/json')) {
      body = await req.json();
    } else if (contentType) {
      body = await req.text();
    }
  }

  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const vercelRequest = {
    method: req.method,
    headers,
    query,
    body
  } as VercelRequest;

  return { vercelRequest };
}

export function createVercelResponse() {
  const headers: Record<string, string> = {};
  const vercelResponse = {
    statusCode: 200,
    body: undefined as unknown,
    headers,
    setHeader(key: string, value: string) {
      headers[key] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    }
  } as VercelResponse & { statusCode: number; body: unknown; headers: Record<string, string> };

  return { vercelResponse, headers };
}
