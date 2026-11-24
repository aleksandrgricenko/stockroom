import express, { type ErrorRequestHandler } from 'express';
import type { Pool } from 'pg';
import { HttpError, operationKey, quantity } from './domain.js';
import * as stock from './stock.js';

export function createApp(db: Pool) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '128kb' }));
  const api = express.Router();
  api.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  api.get('/deliveries', async (_req, res) => { res.json(await stock.deliveries(db)); });
  api.get('/deliveries/:id', async (req, res) => {
    res.json(await stock.delivery(db, quantity(Number(req.params.id), 'Номер поставки', 1)));
  });
  api.post('/deliveries/:id/receipts', async (req, res) => {
    const id = quantity(Number(req.params.id), 'Номер поставки', 1);
    res.status(201).json(await stock.receive(db, operationKey(req.get('Idempotency-Key')), id, req.body));
  });
  api.get('/products', async (_req, res) => { res.json(await stock.products(db)); });
  api.get('/movements', async (req, res) => {
    const sku = req.query.sku ?? '';
    if (typeof sku !== 'string' || sku.length > 80 || sku.includes('\0')) throw new HttpError(400, 'Некорректный SKU.');
    res.json(await stock.movements(db, sku));
  });
  api.post('/issues', async (req, res) => {
    res.status(201).json(await stock.issue(db, operationKey(req.get('Idempotency-Key')), req.body));
  });
  api.use((_req, res) => { res.status(404).json({ error: 'Маршрут не найден.' }); });
  app.use('/api', api);

  const handleError: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
    } else if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
      res.status(error.status).json({ error: 'Некорректный или слишком большой JSON.' });
    } else {
      console.error(error);
      res.status(500).json({ error: 'Ошибка сервера. Повторите попытку.' });
    }
  };
  app.use(handleError);
  return app;
}
