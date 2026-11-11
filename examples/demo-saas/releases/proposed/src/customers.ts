declare const db: { query(sql: string, values?: unknown[]): Promise<unknown> };

export function accountPlan(id: string) {
  return db.query("SELECT id FROM public.accounts WHERE id = $1", [id]);
}

export function customerProfile(id: string) {
  return db.query("SELECT id, display_name FROM public.customers WHERE id = $1", [id]);
}

export function placeOrder(id: string, reference: string) {
  return db.query("INSERT INTO public.orders (id, external_reference) VALUES ($1, $2)", [
    id,
    reference,
  ]);
}
