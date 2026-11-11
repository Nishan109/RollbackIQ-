-- Align the database field with the new profile service.
ALTER TABLE public.customers
  RENAME COLUMN name TO display_name;
