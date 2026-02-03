import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { buildVercelRequest, createVercelResponse } from './adapter.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(runtimeDir, '../../dist');
const knownContentTypes: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const securityHeaders: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://storage.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://storage.googleapis.com https://esm.sh",
    "media-src 'self' blob: data: https://storage.googleapis.com",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join('; ')
};

export function resolveStaticPath(urlPath: string) {
  if (urlPath === '/' || urlPath === '') return path.join(distDir, 'index.html');
  return path.join(distDir, urlPath.replace(/^\//, ''));
}

type ApiHandler = (req: VercelRequest, res: VercelResponse) => Promise<unknown> | unknown;

let cachedRoutes: Record<string, ApiHandler> | null = null;

async function getApiRoutes(): Promise<Record<string, ApiHandler>> {
  if (cachedRoutes) return cachedRoutes;

  const [
    processHandler,
    gcsUploadUrlHandler,
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
    import('../api/process/index.js'),
    import('../api/gcs/upload-url.js'),
    import('../api/chat.js'),
    import('../api/demo/validate.js'),
    import('../api/blob/delete.js'),
    import('../api/admin/generate.js'),
    import('../api/admin/revoke.js'),
    import('../api/admin/events.js'),
    import('../api/admin/stats.js'),
    import('../api/admin/purge.js'),
    import('../api/admin/verify.js'),
    import('../api/admin/list.js')
  ]);

  cachedRoutes = {
    '/api/process': processHandler.default,
    '/api/gcs/upload-url': gcsUploadUrlHandler.default,
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
    ...securityHeaders,
    ...headers
  });
  res.end(JSON.stringify(vercelResponse.body ?? {}));
}

async function handleStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const urlPath = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
  const filePath = resolveStaticPath(urlPath);
  const ext = path.extname(filePath).toLowerCase();
  const expectsFile = ext.length > 0;

  try {
    const stat = await fs.stat(filePath);
    if (stat.isFile()) {
      const data = await fs.readFile(filePath);
      const contentType = knownContentTypes[ext];
      res.writeHead(200, {
        ...securityHeaders,
        ...(contentType ? { 'Content-Type': contentType } : undefined)
      });
      res.end(data);
      return;
    }
  } catch (error) {
    if (expectsFile) {
      console.warn('Static file not found.', { urlPath, filePath, distDir, cwd: process.cwd() });
      res.writeHead(404, { 'Content-Type': 'text/plain', ...securityHeaders });
      res.end('Not found');
      return;
    }
  }

  const indexPath = path.join(distDir, 'index.html');
  const index = await fs.readFile(indexPath);
  res.writeHead(200, { 'Content-Type': 'text/html', ...securityHeaders });
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
