import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/http.js';
import { databaseFixture } from './fixture.js';

const demo = 'BX-210';
const receiptPath = '/deliveries/1/receipts';
const receipt = (accepted: number, rejected = 0, reason?: string) => ({
  lines: [{ sku: demo, accepted, rejected, reason }],
});
const issueBody = (quantity: number) => ({ sku: demo, quantity, basis: 'Заявка Р-018' });

async function fixture() {
  const { db, schema, close } = await databaseFixture();
  const server = createApp(db).listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api';
  async function read(path: string) {
    const res = await fetch(url + path);
    assert.equal(res.status, 200);
    return res.json();
  }
  async function write(path: string, payload: object, key = randomUUID()) {
    const res = await fetch(url + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json() };
  }
  async function balance() {
    const { rows: [row] } = await db.query('SELECT balance FROM products WHERE sku = $1', [demo]);
    return row.balance;
  }
  async function concurrent(lock: string, first: () => Promise<unknown>, second: () => Promise<unknown>) {
    const gate = await db.connect();
    let requests: Promise<unknown>[] = [];
    try {
      await gate.query('BEGIN');
      await gate.query(lock);
      requests = [first(), second()];
      // Prove both API requests are active and blocked before releasing the gate.
      const deadline = Date.now() + 5000;
      while (true) {
        const { rows: [row] } = await db.query(`
          SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE application_name = $1 AND wait_event_type = 'Lock'`, [schema]);
        if (row.waiting === 2) break;
        assert.ok(Date.now() < deadline, 'Both transactions must wait on PostgreSQL locks');
        await setTimeout(20);
      }
    } finally {
      await gate.query('ROLLBACK').finally(() => gate.release());
    }
    return Promise.all(requests) as Promise<Awaited<ReturnType<typeof write>>[]>;
  }
  return {
    db, read, write, balance, concurrent,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await close();
    },
  };
}

test('partial receipt, defect reason, closing and issuing reconcile balances with the ledger', async (t) => {
  const app = await fixture();
  t.after(app.close);
  const invalid = await app.write(receiptPath, receipt(6, 1));
  assert.equal(invalid.status, 400);
  assert.equal(await app.balance(), 0);

  const first = await app.write(receiptPath, receipt(6, 1, 'Смята коробка'));
  assert.equal(first.status, 201);
  assert.equal(first.body.status, 'partial');
  const detail = await app.read('/deliveries/1');
  assert.equal(detail.lines[0].accepted, 6);
  assert.equal(detail.lines[0].rejected, 1);
  assert.equal(detail.batches[0].lines[0].reason, 'Смята коробка');
  assert.equal(await app.balance(), 6);

  const second = await app.write(receiptPath, receipt(3));
  assert.equal(second.status, 201);
  assert.equal(second.body.status, 'completed');
  assert.equal(await app.balance(), 9);
  assert.equal((await app.write('/issues', issueBody(4))).status, 201);
  assert.equal(await app.balance(), 5);

  const before = await app.read('/movements?sku=' + demo);
  const insufficient = await app.write('/issues', issueBody(6));
  assert.equal(insufficient.status, 409);
  assert.match(insufficient.body.error, /доступно 5 шт/);
  assert.deepEqual(await app.read('/movements?sku=' + demo), before);
  assert.equal(await app.balance(), 5);
  assert.deepEqual(before.map(({ kind, quantity, basis, deliveryId }: Record<string, unknown>) =>
    [kind, quantity, basis, deliveryId]), [
    ['issue', 4, 'Заявка Р-018', null], ['receipt', 3, 'ПСТ-1048', 1], ['receipt', 6, 'ПСТ-1048', 1],
  ]);
});

test('rejection-only receipt closes the delivery without adding stock or movement', async (t) => {
  const app = await fixture();
  t.after(app.close);
  const result = await app.write(receiptPath, receipt(0, 10, 'Намокли'));
  assert.equal(result.status, 201);
  assert.equal(result.body.status, 'completed');
  assert.equal(await app.balance(), 0);
  assert.deepEqual(await app.read('/movements?sku=' + demo), []);
});

test('invalid second line rolls back the first line, movement, stock and key', async (t) => {
  const app = await fixture();
  t.after(app.close);
  const key = randomUUID();
  const path = '/deliveries/2/receipts';
  const body = { lines: [
    { sku: 'LB-100', accepted: 2, rejected: 1, reason: 'Мокрая упаковка' },
    { sku: 'TP-048', accepted: 25, rejected: 0 },
  ] };
  const before = await Promise.all([app.read('/deliveries/2'), app.read('/products'), app.read('/movements')]);
  assert.equal((await app.write(path, body, key)).status, 409);
  assert.deepEqual(await Promise.all([app.read('/deliveries/2'), app.read('/products'), app.read('/movements')]), before);
  assert.equal((await app.db.query('SELECT id FROM operations WHERE id = $1', [key])).rowCount, 0);
  body.lines[1].accepted = 4;
  assert.equal((await app.write(path, body, key)).status, 201);
});

test('same payload and key replay original receipt and issue results after later writes', async (t) => {
  const app = await fixture();
  t.after(app.close);
  const receiptKey = randomUUID();
  const issueKey = randomUUID();
  const first = await app.write(receiptPath, receipt(6), receiptKey);
  assert.equal(first.status, 201);
  assert.equal((await app.write(receiptPath, receipt(4))).status, 201);
  assert.deepEqual(await app.write(receiptPath, receipt(6), receiptKey), first);
  assert.equal((await app.write(receiptPath, receipt(5), receiptKey)).status, 409);
  assert.equal((await app.write(receiptPath, receipt(6, 1), receiptKey)).status, 409);

  const issued = await app.write('/issues', issueBody(4), issueKey);
  assert.equal(issued.status, 201);
  assert.equal((await app.write('/issues', issueBody(1))).status, 201);
  assert.deepEqual(await app.write('/issues', issueBody(4), issueKey), issued);
  assert.deepEqual(await app.write('/issues', { basis: 'Заявка Р-018', quantity: 4, sku: demo }, issueKey), issued);
  assert.equal((await app.write('/issues', issueBody(3), issueKey)).status, 409);
  assert.equal((await app.write('/issues', issueBody(4), receiptKey)).status, 409);
  assert.equal(await app.balance(), 5);
  assert.equal((await app.read('/movements?sku=' + demo)).length, 4);
});

test('concurrent receipt requests cannot exceed the ordered quantity', async (t) => {
  const app = await fixture();
  t.after(app.close);
  const results = await app.concurrent('SELECT id FROM deliveries WHERE id = 1 FOR UPDATE',
    () => app.write(receiptPath, receipt(6)), () => app.write(receiptPath, receipt(6)));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(await app.balance(), 6);
  assert.equal((await app.read('/deliveries/1')).accepted, 6);
  assert.equal((await app.read('/movements?sku=' + demo)).length, 1);
});

test('concurrent issue requests cannot oversell a SKU', async (t) => {
  const app = await fixture();
  t.after(app.close);
  assert.equal((await app.write(receiptPath, receipt(9))).status, 201);
  const results = await app.concurrent("SELECT sku FROM products WHERE sku = 'BX-210' FOR NO KEY UPDATE",
    () => app.write('/issues', issueBody(6)), () => app.write('/issues', issueBody(6)));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(await app.balance(), 3);
  assert.equal((await app.read('/movements?sku=' + demo)).length, 2);
});

test('concurrent duplicate keys replay exactly once and conflicting payloads return 409', async (t) => {
  const app = await fixture();
  t.after(app.close);
  const key = randomUUID();
  const [first, replay] = await app.concurrent('SELECT id FROM deliveries WHERE id = 1 FOR UPDATE',
    () => app.write(receiptPath, receipt(6), key), () => app.write(receiptPath, receipt(6), key));
  assert.equal(first.status, 201);
  assert.deepEqual(first, replay);
  assert.equal((await app.read('/movements?sku=' + demo)).length, 1);
  const issueKey = randomUUID();
  const results = await app.concurrent("SELECT sku FROM products WHERE sku = 'BX-210' FOR NO KEY UPDATE",
    () => app.write('/issues', issueBody(2), issueKey), () => app.write('/issues', issueBody(3), issueKey));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const winner = results.find((r) => r.status === 201)!;
  assert.equal(await app.balance(), winner.body.balance);
  assert.equal((await app.read('/movements?sku=' + demo)).length, 2);
});
