import 'dotenv/config';
import http from 'http';
import { runJob } from './handler.js';
import { toPublicError } from '../api/_lib/errors.js';

const PORT = Number(process.env.PORT ?? 8080);

const readBody = async (req: http.IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

const unauthorized = (res: http.ServerResponse) => {
  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: { code: 'unauthorized', message: 'Unauthorized.' } }));
};

const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method !== 'POST' || req.url !== '/worker/run') {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'not_found', message: 'Not found.' } }));
    return;
  }

  const secret = process.env.WORKER_SHARED_SECRET;
  const authHeader = req.headers.authorization ?? '';
  if (!secret || authHeader !== `Bearer ${secret}`) {
    unauthorized(res);
    return;
  }

  try {
    const rawBody = await readBody(req);
    const parsed = rawBody ? (JSON.parse(rawBody) as { jobId?: string }) : {};
    if (!parsed.jobId) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { code: 'missing_job_id', message: 'jobId is required.' } }));
      return;
    }

    const result = await runJob(parsed.jobId);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    const stack = error instanceof Error ? error.stack : undefined;
    console.error('Worker run failed:', message, stack ?? '');
    const publicError = toPublicError(error);
    if (message.includes('Job not found')) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { code: 'job_not_found', message: 'Job not found.' } }));
      return;
    }
    if (message.includes('KV not configured')) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { code: 'kv_not_configured', message } }));
      return;
    }
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: publicError }));
  }
};

const server = http.createServer((req, res) => {
  handler(req, res).catch((error) => {
    console.error('Worker handler failed:', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'internal_error', message: 'Internal error.' } }));
  });
});

server.listen(PORT, () => {
  console.log(`Worker listening on ${PORT}`);
});
