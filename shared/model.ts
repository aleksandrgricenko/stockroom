export const statusLabels = {
  expected: 'Ожидается',
  partial: 'Частично обработана',
  completed: 'Обработана',
} as const;

export type Status = keyof typeof statusLabels;

export interface Delivery {
  id: number;
  number: string;
  supplier: string;
  expectedOn: string;
  positions: number;
  ordered: number;
  accepted: number;
  rejected: number;
  status: Status;
}

export interface DeliveryLine {
  sku: string;
  name: string;
  ordered: number;
  accepted: number;
  rejected: number;
}

export interface ReceiptLine {
  sku: string;
  accepted: number;
  rejected: number;
  reason: string | null;
}

export interface DeliveryDetail extends Delivery {
  lines: DeliveryLine[];
  batches: { id: string; lines: ReceiptLine[] }[];
}

export interface Product {
  sku: string;
  name: string;
  balance: number;
}

export interface Movement {
  id: string;
  sku: string;
  name: string;
  createdAt: string;
  kind: 'receipt' | 'issue';
  quantity: number;
  basis: string;
  deliveryId: number | null;
}
