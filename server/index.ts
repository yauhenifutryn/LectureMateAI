import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { buildVercelRequest, createVercelResponse } from './adapter';
import processHandler from '../api/process';
import uploadHandler from '../api/upload';
import chatHandler from '../api/chat';
import demoValidateHandler from '../api/demo/validate';
import blobDeleteHandler from '../api/blob/delete';
import adminGenerateHandler from '../api/admin/generate';
import adminRevokeHandler from '../api/admin/revoke';
import adminEventsHandler from '../api/admin/events';
import adminStatsHandler from '../api/admin/stats';
import adminPurgeHandler from '../api/admin/purge';
import adminVerifyHandler from '../api/admin/verify';
import adminListHandler from '../api/admin/list';

const distDir = path.join(process.cwd(), 'dist');

export function resolveStaticPath(urlPath: string) {
  if (urlPath === '/' || urlPath === '') return path.join(distDir, 'index.html');
  return path.join(distDir, urlPath.replace(/^\//, ''));
}

const apiRoutes: Record<string, typeof processHandler> = {
  '/api/process': processHandler,
  '/api/upload': uploadHandler,
  '/api/chat': chatHandler,
  '/api/demo/validate': demoValidateHandler,
  '/api/blob/delete': blobDeleteHandler,
  '/api/admin/generate': adminGenerateHandler,
  '/api/admin/revoke': adminRevokeHandler,
  '/api/admin/events': adminEventsHandler,
  '/api/admin/stats': adminStatsHandler,
  '/api/admin/purge': adminPurgeHandler,
  '/api/admin/verify': adminVerifyHandler,
  '/api/admin/list': adminListHandler
};

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
  const handler = apiRoutes[url.pathname];
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
