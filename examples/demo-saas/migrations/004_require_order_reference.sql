-- Require an external reference for reconciliation.
ALTER TABLE public.orders
  ALTER COLUMN external_reference SET NOT NULL;
