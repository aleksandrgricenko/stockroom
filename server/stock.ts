import type { Pool, PoolClient } from 'pg';
import type { Delivery, DeliveryDetail, DeliveryLine, Movement, Product, ReceiptLine } from '../shared/model.js';
import { deliveryStatus, HttpError, maxQuantity, parseIssue, parseReceipt } from './domain.js';

type DeliveryRow = Omit<Delivery, 'status'>;
type LineTotals = Omit<DeliveryLine, 'name'>;

const deliverySummary = `
  SELECT d.id, d.number, d.supplier, d.expected_on::text AS "expectedOn",
         count(l.sku)::int AS positions, coalesce(sum(l.ordered), 0)::float8 AS ordered,
         coalesce(sum(l.accepted), 0)::float8 AS accepted, coalesce(sum(l.rejected), 0)::float8 AS rejected
  FROM deliveries d LEFT JOIN delivery_lines l ON l.delivery_id = d.id
`;

function withStatus(row: DeliveryRow): Delivery {
  return { ...row, status: deliveryStatus(row.ordered, row.accepted, row.rejected) };
}

export async function deliveries(db: Pool) {
  const result = await db.query<DeliveryRow>(`${deliverySummary} GROUP BY d.id ORDER BY d.expected_on DESC, d.id DESC`);
  return result.rows.map(withStatus);
}

export async function delivery(db: Pool, id: number): Promise<DeliveryDetail> {
  const { rows } = await db.query<Omit<DeliveryDetail, 'status'>>(`
    WITH summary AS (${deliverySummary} WHERE d.id = $1 GROUP BY d.id)
    SELECT s.*,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('sku', l.sku, 'name', p.name,
          'ordered', l.ordered, 'accepted', l.accepted, 'rejected', l.rejected) ORDER BY l.sku), '[]')
       FROM delivery_lines l JOIN products p USING (sku) WHERE l.delivery_id = s.id) AS lines,
      (SELECT coalesce(jsonb_agg(to_jsonb(batch) ORDER BY batch.id), '[]') FROM (
         SELECT r.operation_id AS id, jsonb_agg(jsonb_build_object('sku', r.sku,
              'accepted', r.accepted, 'rejected', r.rejected, 'reason', r.reason) ORDER BY r.sku) AS lines
         FROM receipt_lines r WHERE r.delivery_id = s.id GROUP BY r.operation_id
       ) batch) AS batches
    FROM summary s`, [id]);
  if (!rows[0]) throw new HttpError(404, 'Поставка не найдена.');
  return { ...rows[0], status: deliveryStatus(rows[0].ordered, rows[0].accepted, rows[0].rejected) };
}

export async function products(db: Pool) {
  return (await db.query<Product>('SELECT sku, name, balance FROM products ORDER BY sku')).rows;
}

export async function movements(db: Pool, sku: string) {
  return (await db.query<Movement>(`
    SELECT m.id, m.sku, p.name, m.created_at AS "createdAt", m.kind, m.quantity,
           m.basis, m.delivery_id AS "deliveryId"
    FROM movements m JOIN products p USING (sku)
    WHERE ($1 = '' OR m.sku = $1)
    ORDER BY m.id DESC`, [sku])).rows;
}

async function operation<T>(pool: Pool, key: string, payload: object, apply: (db: PoolClient) => Promise<T>): Promise<T> {
  // Canonicalize JSON object keys so property order does not affect a retry.
  const request = JSON.stringify(payload, (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  });
  const db = await pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const claim = await db.query(`
      INSERT INTO operations (id, request) VALUES ($1, $2)
      ON CONFLICT (id) DO NOTHING RETURNING id`, [key, request]);
    if (claim.rowCount === 0) {
      // Separate statement sees the committed winner after the unique-index wait.
      const { rows: [previous] } = await db.query<{ same: boolean; result: T }>(
        'SELECT request = $2 AS same, result FROM operations WHERE id = $1', [key, request]);
      if (!previous.same) throw new HttpError(409, 'Этот ключ операции уже использован с другими данными.');
      await db.query('COMMIT');
      return previous.result;
    }
    const result = await apply(db);
    await db.query('UPDATE operations SET result = $2::jsonb WHERE id = $1', [key, JSON.stringify(result)]);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

export function receive(pool: Pool, key: string, id: number, body: unknown) {
  return operation(pool, key, { kind: 'receipt', id, body }, async (db) => {
    const lines = parseReceipt(body);
    // Lock the delivery first, then the affected product rows in SKU order.
    const header = await db.query<{ number: string }>('SELECT number FROM deliveries WHERE id = $1 FOR UPDATE', [id]);
    if (!header.rows[0]) throw new HttpError(404, 'Поставка не найдена.');
    const { rows: current } = await db.query<LineTotals>(
      'SELECT sku, ordered, accepted, rejected FROM delivery_lines WHERE delivery_id = $1', [id]);
    const bySku = new Map(current.map((line) => [line.sku, line]));
    const { rows: stock } = await db.query<Product>(`
      SELECT sku, balance FROM products WHERE sku = ANY($1::text[]) ORDER BY sku FOR NO KEY UPDATE`,
    [lines.filter((line) => line.accepted > 0).map((line) => line.sku)]);
    const balances = new Map(stock.map((item) => [item.sku, item.balance]));

    for (const line of lines) {
      const saved = bySku.get(line.sku);
      if (!saved) throw new HttpError(400, `Позиция ${line.sku} отсутствует в поставке.`);
      const remaining = saved.ordered - saved.accepted - saved.rejected;
      if (line.accepted + line.rejected > remaining) {
        throw new HttpError(409, `${line.sku}: осталось обработать ${remaining} шт. Обновите поставку перед повтором.`);
      }
      if ((balances.get(line.sku) ?? 0) + line.accepted > maxQuantity) {
        throw new HttpError(409, `${line.sku}: превышен максимальный остаток.`);
      }
      await saveReceiptLine(db, key, id, header.rows[0].number, line);
      saved.accepted += line.accepted;
      saved.rejected += line.rejected;
    }

    const total = current.reduce((sum, line) => ({
      ordered: sum.ordered + line.ordered,
      accepted: sum.accepted + line.accepted,
      rejected: sum.rejected + line.rejected,
    }), { ordered: 0, accepted: 0, rejected: 0 });
    return { operationId: key, deliveryId: id, ...total, status: deliveryStatus(total.ordered, total.accepted, total.rejected) };
  });
}

async function saveReceiptLine(db: PoolClient, key: string, id: number, number: string, line: ReceiptLine) {
  await db.query(`
    UPDATE delivery_lines SET accepted = accepted + $3, rejected = rejected + $4
    WHERE delivery_id = $1 AND sku = $2`, [id, line.sku, line.accepted, line.rejected]);
  await db.query(`
    INSERT INTO receipt_lines (operation_id, delivery_id, sku, accepted, rejected, reason)
    VALUES ($1, $2, $3, $4, $5, $6)`, [key, id, line.sku, line.accepted, line.rejected, line.reason]);
  if (line.accepted === 0) return;
  await db.query('UPDATE products SET balance = balance + $2 WHERE sku = $1', [line.sku, line.accepted]);
  await db.query(`
    INSERT INTO movements (operation_id, sku, kind, quantity, basis, delivery_id)
    VALUES ($1, $2, 'receipt', $3, $4, $5)`, [key, line.sku, line.accepted, number, id]);
}

export function issue(pool: Pool, key: string, body: unknown) {
  return operation(pool, key, { kind: 'issue', body }, async (db) => {
    const item = parseIssue(body);
    const { rows: [product] } = await db.query<Product>(
      'SELECT balance FROM products WHERE sku = $1 FOR NO KEY UPDATE', [item.sku]);
    if (!product) throw new HttpError(404, 'SKU не найден.');
    if (product.balance < item.quantity) {
      throw new HttpError(409, `Недостаточно товара ${item.sku}: доступно ${product.balance} шт., запрошено ${item.quantity} шт.`);
    }
    await db.query('UPDATE products SET balance = balance - $2 WHERE sku = $1', [item.sku, item.quantity]);
    await db.query(`
      INSERT INTO movements (operation_id, sku, kind, quantity, basis)
      VALUES ($1, $2, 'issue', $3, $4)`, [key, item.sku, item.quantity, item.basis]);
    return { operationId: key, sku: item.sku, balance: product.balance - item.quantity };
  });
}
