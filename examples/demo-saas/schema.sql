CREATE TABLE public.accounts (id uuid PRIMARY KEY, legacy_tier text);
CREATE TABLE public.customers (id uuid PRIMARY KEY, name text);
CREATE TABLE public.orders (id uuid PRIMARY KEY, external_reference text);
