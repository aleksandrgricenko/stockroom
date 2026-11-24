import express from 'express';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { createApp } from './http.js';

if (!process.env.DATABASE_URL) throw new Error('Задайте DATABASE_URL. Пример есть в .env.example.');
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await db.query('SELECT 1');

const app = createApp(db);
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);

if (process.argv.includes('--dev')) {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  const client = fileURLToPath(new URL('../client/', import.meta.url));
  app.use(express.static(client));
  app.get('/{*path}', (_req, res) => { res.sendFile('index.html', { root: client }); });
}

const server = app.listen(port, host, () => console.log(`Stockroom: http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => { void db.end().then(() => process.exit(0)); }));
}
