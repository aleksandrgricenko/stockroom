import type { ReceiptLine, Status } from '../shared/model.js';

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function deliveryStatus(ordered: number, accepted: number, rejected: number): Status {
  const processed = accepted + rejected;
  if (processed === 0) return 'expected';
  return processed === ordered ? 'completed' : 'partial';
}

export const maxQuantity = 2_147_483_647;

export function quantity(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maxQuantity) {
    throw new HttpError(400, `${label}: введите целое число от ${minimum} до ${maxQuantity}.`);
  }
  return value;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Ожидается объект JSON.');
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit || value.includes('\0')) {
    throw new HttpError(400, `${label}: введите от 1 до ${limit} символов.`);
  }
  return value.trim();
}

export function parseReceipt(value: unknown): ReceiptLine[] {
  const { lines } = object(value);
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 100) {
    throw new HttpError(400, 'Укажите от 1 до 100 позиций для приёмки.');
  }
  const used = new Set<string>();
  return lines.map((value) => {
    const row = object(value);
    const sku = requiredText(row.sku, 'SKU', 80);
    if (used.has(sku)) throw new HttpError(400, `Позиция ${sku} указана дважды.`);
    used.add(sku);
    const accepted = quantity(row.accepted, `${sku} · принято`);
    const rejected = quantity(row.rejected, `${sku} · отклонено`);
    if (accepted === 0 && rejected === 0) throw new HttpError(400, `Укажите количество для ${sku}.`);
    const reason = rejected > 0 ? requiredText(row.reason, `${sku} · причина отклонения`, 300) : null;
    return { sku, accepted, rejected, reason };
  }).sort((a, b) => a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0);
}

export function parseIssue(value: unknown) {
  const row = object(value);
  return {
    sku: requiredText(row.sku, 'SKU', 80),
    quantity: quantity(row.quantity, 'Количество', 1),
    basis: requiredText(row.basis, 'Основание выдачи', 300),
  };
}

export function operationKey(value: string | undefined): string {
  if (!value || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, 'Укажите UUID в заголовке Idempotency-Key.');
  }
  return value.toLowerCase();
}
