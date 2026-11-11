-- Add an optional note for the receipt page.
ALTER TABLE public.orders
  ADD COLUMN receipt_note text;
