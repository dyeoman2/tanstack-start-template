import http from 'node:http';
import { Readable } from 'node:stream';

import app from '../dist/server/server.js';

const port = Number(process.env.PORT ?? '3000');
const host = process.env.HOST ?? '0.0.0.0';

function toRequest(req) {
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
    } else {
      headers.set(key, value);
    }
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);
  const method = req.method ?? 'GET';
  const canHaveBody = method !== 'GET' && method !== 'HEAD';

  return new Request(url, {
    method,
    headers,
    body: canHaveBody ? Readable.toWeb(req) : undefined,
    duplex: canHaveBody ? 'half' : undefined,
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const response = await app.fetch(toRequest(req));

    res.statusCode = response.status;

    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    if (!response.body) {
      res.end();
      return;
    }

    Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    console.error('[start-server] Request handling failed.', error);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
});

server.listen(port, host, () => {
  console.info(`[start-server] Listening on http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
