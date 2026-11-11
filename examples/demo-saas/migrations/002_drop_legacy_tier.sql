-- Remove the legacy account tier after the plan migration.
ALTER TABLE public.accounts
  DROP COLUMN legacy_tier;
