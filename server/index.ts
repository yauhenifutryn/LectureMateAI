import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { buildVercelRequest, createVercelResponse } from './adapter';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const distDir = path.join(process.cwd(), 'dist');

export function resolveStaticPath(urlPath: string) {
  if (urlPath === '/' || urlPath === '') return path.join(distDir, 'index.html');
  return path.join(distDir, urlPath.replace(/^\//, ''));
}

type ApiHandler = (req: VercelRequest, res: VercelResponse) => Promise<unknown> | unknown;

let cachedRoutes: Record<string, ApiHandler> | null = null;

async function getApiRoutes(): Promise<Record<string, ApiHandler>> {
  if (cachedRoutes) return cachedRoutes;

  const useTs = process.env.NODE_ENV === 'test';

  const [
    processHandler,
    uploadHandler,
    chatHandler,
    demoValidateHandler,
    blobDeleteHandler,
    adminGenerateHandler,
    adminRevokeHandler,
    adminEventsHandler,
    adminStatsHandler,
    adminPurgeHandler,
    adminVerifyHandler,
    adminListHandler
  ] = await Promise.all([
    useTs ? import('../api/process/index.ts') : import('../api/process/index.js'),
    useTs ? import('../api/upload/index.ts') : import('../api/upload/index.js'),
    useTs ? import('../api/chat/index.ts') : import('../api/chat/index.js'),
    useTs ? import('../api/demo/validate.ts') : import('../api/demo/validate.js'),
    useTs ? import('../api/blob/delete.ts') : import('../api/blob/delete.js'),
    useTs ? import('../api/admin/generate.ts') : import('../api/admin/generate.js'),
    useTs ? import('../api/admin/revoke.ts') : import('../api/admin/revoke.js'),
    useTs ? import('../api/admin/events.ts') : import('../api/admin/events.js'),
    useTs ? import('../api/admin/stats.ts') : import('../api/admin/stats.js'),
    useTs ? import('../api/admin/purge.ts') : import('../api/admin/purge.js'),
    useTs ? import('../api/admin/verify.ts') : import('../api/admin/verify.js'),
    useTs ? import('../api/admin/list.ts') : import('../api/admin/list.js')
  ]);

  cachedRoutes = {
    '/api/process': processHandler.default,
    '/api/upload': uploadHandler.default,
    '/api/chat': chatHandler.default,
    '/api/demo/validate': demoValidateHandler.default,
    '/api/blob/delete': blobDeleteHandler.default,
    '/api/admin/generate': adminGenerateHandler.default,
    '/api/admin/revoke': adminRevokeHandler.default,
    '/api/admin/events': adminEventsHandler.default,
    '/api/admin/stats': adminStatsHandler.default,
    '/api/admin/purge': adminPurgeHandler.default,
    '/api/admin/verify': adminVerifyHandler.default,
    '/api/admin/list': adminListHandler.default
  };

  return cachedRoutes;
}

async function readRequestBody(req: http.IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  if (!chunks.length) return undefined;
  return Buffer.concat(chunks).toString('utf8');
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const routes = await getApiRoutes();
  const handler = routes[url.pathname];
  if (!handler) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'not_found', message: 'Not found.' } }));
    return;
  }

  const bodyString = await readRequestBody(req);
  const request = new Request(url.toString(), {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: bodyString
  });

  const { vercelRequest } = await buildVercelRequest(request);
  const { vercelResponse, headers } = createVercelResponse();

  await handler(vercelRequest, vercelResponse);

  res.writeHead(vercelResponse.statusCode, {
    'Content-Type': 'application/json',
    ...headers
  });
  res.end(JSON.stringify(vercelResponse.body ?? {}));
}

async function handleStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const urlPath = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
  const filePath = resolveStaticPath(urlPath);

  try {
    const stat = await fs.stat(filePath);
    if (stat.isFile()) {
      const data = await fs.readFile(filePath);
      res.writeHead(200);
      res.end(data);
      return;
    }
  } catch (error) {
    // fallthrough to index
  }

  const indexPath = path.join(distDir, 'index.html');
  const index = await fs.readFile(indexPath);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(index);
}

const server = http.createServer(async (req, res) => {
  const urlPath = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
  if (urlPath.startsWith('/api/')) {
    await handleApi(req, res);
    return;
  }
  await handleStatic(req, res);
});

const port = Number(process.env.PORT || 8080);
if (process.env.NODE_ENV !== 'test') {
  server.listen(port, () => {
    console.log(`Server listening on ${port}`);
  });
}
