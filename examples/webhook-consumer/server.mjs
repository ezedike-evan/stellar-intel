#!/usr/bin/env node
import http from 'node:http';
import { verifyWebhook } from './verify.mjs';

const PORT = parseInt(process.env.PORT || '8787', 10);
const SECRET = process.env.WEBHOOK_SECRET || '';

// Bounded in-memory idempotency deduplication cache
const seenKeys = new Set();
const MAX_KEYS = 10000;

function rememberKey(key) {
  if (!key) return;
  if (seenKeys.size >= MAX_KEYS) {
    const oldest = seenKeys.values().next().value;
    if (oldest !== undefined) seenKeys.delete(oldest);
  }
  seenKeys.add(key);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }

  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const rawBody = Buffer.concat(chunks);
    const signatureHeader = req.headers['x-webhook-signature'];

    const verification = verifyWebhook({
      secret: SECRET,
      signatureHeader,
      rawBody,
    });

    if (!verification.ok) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Webhook verification failed',
          reason: verification.reason,
        })
      );
      return;
    }

    const idempotencyKey = req.headers['x-webhook-idempotency-key'];
    if (idempotencyKey) {
      if (seenKeys.has(idempotencyKey)) {
        // Duplicate delivery: acknowledge with 200 without reprocessing
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true, duplicate: true }));
        return;
      }
      rememberKey(idempotencyKey);
    }

    try {
      const payload = JSON.parse(rawBody.toString('utf-8'));
      const kind = payload?.kind || 'unknown';
      const id = payload?.id || 'unknown';
      console.log(`[webhook] Received event: kind=${kind} id=${id}`);
    } catch {
      console.log('[webhook] Received event (non-JSON or unparsed body)');
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ received: true }));
  });
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`Webhook consumer listening on port ${PORT}`);
  });
}

export { server };
