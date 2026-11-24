import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deliveryStatus, maxQuantity, parseIssue, parseReceipt, quantity } from '../server/domain.js';

test('delivery status counts accepted and rejected units', () => {
  assert.equal(deliveryStatus(10, 0, 0), 'expected');
  assert.equal(deliveryStatus(10, 6, 1), 'partial');
  assert.equal(deliveryStatus(10, 9, 1), 'completed');
  assert.equal(deliveryStatus(10, 0, 10), 'completed');
});

test('quantities are bounded integers with operation-specific minimums', () => {
  assert.equal(quantity(0, 'test'), 0);
  assert.equal(quantity(maxQuantity, 'test'), maxQuantity);
  for (const value of [-1, 1.5, '2', null, false, NaN, Infinity, maxQuantity + 1]) {
    assert.throws(() => quantity(value, 'test'), /целое число/);
  }
  assert.throws(() => parseIssue({ sku: 'BX-210', quantity: 0, basis: 'Заявка' }), /от 1/);
});

test('receipt requires a reason for rejected units and a single nonempty row per SKU', () => {
  const row = { sku: 'BX-210', accepted: 0, rejected: 1 };
  assert.throws(() => parseReceipt({ lines: [row] }), /причина отклонения/);
  assert.throws(() => parseReceipt({ lines: [{ ...row, reason: '  ' }] }), /причина отклонения/);
  assert.throws(() => parseReceipt({ lines: [{ ...row, rejected: 0 }] }), /Укажите количество/);
  const valid = { ...row, reason: ' Упаковка повреждена ' };
  assert.throws(() => parseReceipt({ lines: [valid, valid] }), /дважды/);
  assert.deepEqual(parseReceipt({ lines: [valid] }), [{ ...row, reason: 'Упаковка повреждена' }]);
});
