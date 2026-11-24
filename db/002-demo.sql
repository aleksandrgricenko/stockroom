BEGIN;

INSERT INTO products (sku, name) VALUES
  ('BX-210', 'Коробка складская M'),
  ('TP-048', 'Лента упаковочная 48 мм'),
  ('LB-100', 'Этикетки термо 100×50'),
  ('GL-012', 'Перчатки рабочие'),
  ('FL-500', 'Плёнка стрейч 500 мм');

INSERT INTO deliveries (number, supplier, expected_on) VALUES
  ('ПСТ-1048', 'Северная Упаковка', CURRENT_DATE),
  ('ПСТ-1047', 'Линия Снабжения', CURRENT_DATE - 1),
  ('ПСТ-1046', 'Точка Комплектации', CURRENT_DATE - 2),
  ('ПСТ-1045', 'Северная Упаковка', CURRENT_DATE - 4),
  ('ПСТ-1044', 'Линия Снабжения', CURRENT_DATE - 6);

INSERT INTO delivery_lines (delivery_id, sku, ordered, accepted, rejected) VALUES
  (1, 'BX-210', 10, 0, 0),
  (2, 'TP-048', 24, 0, 0),
  (2, 'LB-100', 16, 0, 0),
  (3, 'GL-012', 30, 12, 2),
  (4, 'FL-500', 20, 0, 0),
  (5, 'LB-100', 18, 18, 0),
  (5, 'TP-048', 12, 12, 0);

INSERT INTO operations (id, request, result) VALUES
  ('00000000-0000-4000-8000-000000000001', '{"kind":"demo"}', '{}'),
  ('00000000-0000-4000-8000-000000000002', '{"kind":"demo"}', '{}');

INSERT INTO receipt_lines (operation_id, delivery_id, sku, accepted, rejected, reason) VALUES
  ('00000000-0000-4000-8000-000000000001', 5, 'LB-100', 18, 0, NULL),
  ('00000000-0000-4000-8000-000000000001', 5, 'TP-048', 12, 0, NULL),
  ('00000000-0000-4000-8000-000000000002', 3, 'GL-012', 12, 2, 'Повреждена упаковка');

INSERT INTO movements (operation_id, sku, created_at, kind, quantity, basis, delivery_id)
SELECT r.operation_id, r.sku, (d.expected_on + time '10:00') AT TIME ZONE 'Europe/Moscow',
       'receipt', r.accepted, d.number, r.delivery_id
FROM receipt_lines r JOIN deliveries d ON d.id = r.delivery_id
ORDER BY d.expected_on, r.sku;

UPDATE products p SET balance = totals.quantity
FROM (SELECT sku, sum(quantity)::integer AS quantity FROM movements GROUP BY sku) totals
WHERE totals.sku = p.sku;

COMMIT;
