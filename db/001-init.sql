BEGIN;

CREATE TABLE products (
  sku text PRIMARY KEY,
  name text NOT NULL,
  balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0)
);

CREATE TABLE deliveries (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  number text NOT NULL UNIQUE,
  supplier text NOT NULL,
  expected_on date NOT NULL
);

CREATE TABLE delivery_lines (
  delivery_id integer NOT NULL REFERENCES deliveries(id),
  sku text NOT NULL REFERENCES products(sku),
  ordered integer NOT NULL CHECK (ordered > 0),
  accepted integer NOT NULL DEFAULT 0 CHECK (accepted BETWEEN 0 AND ordered),
  rejected integer NOT NULL DEFAULT 0 CHECK (rejected BETWEEN 0 AND ordered - accepted),
  PRIMARY KEY (delivery_id, sku)
);

CREATE TABLE operations (
  id uuid PRIMARY KEY,
  request text NOT NULL,
  result jsonb
);

CREATE TABLE receipt_lines (
  operation_id uuid NOT NULL REFERENCES operations(id),
  delivery_id integer NOT NULL,
  sku text NOT NULL,
  accepted integer NOT NULL CHECK (accepted >= 0),
  rejected integer NOT NULL CHECK (rejected >= 0),
  reason text,
  CHECK (accepted > 0 OR rejected > 0),
  CHECK (rejected = 0 OR (reason IS NOT NULL AND length(btrim(reason)) > 0)),
  PRIMARY KEY (operation_id, sku),
  FOREIGN KEY (delivery_id, sku) REFERENCES delivery_lines(delivery_id, sku)
);

CREATE TABLE movements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES operations(id),
  sku text NOT NULL REFERENCES products(sku),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  kind text NOT NULL CHECK (kind IN ('receipt', 'issue')),
  quantity integer NOT NULL CHECK (quantity > 0),
  basis text NOT NULL CHECK (length(btrim(basis)) > 0),
  delivery_id integer,
  CHECK ((kind = 'receipt') = (delivery_id IS NOT NULL)),
  FOREIGN KEY (delivery_id, sku) REFERENCES delivery_lines(delivery_id, sku),
  UNIQUE (operation_id, sku)
);

CREATE INDEX movements_sku_id_idx ON movements (sku, id DESC);

COMMIT;
