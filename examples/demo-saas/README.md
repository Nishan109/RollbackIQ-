# Acme Commerce demo

This is a synthetic PostgreSQL commerce repository. The web demo and CLI scan the SQL files in `migrations/`. They represent separate changes to existing accounts, customers and orders. The scanner parses these examples without running them against a database.

The workspace also compares `releases/previous/src/customers.ts` with `releases/proposed/src/customers.ts` using the table declarations in `schema.sql`. The earlier application queries `legacy_tier` and `name`. The candidate drops and renames those columns, respectively. Both snapshots contain an order writer, which supplies evidence for reviewing the new `NOT NULL` requirement.

| File                              | Expected result                                                             |
| --------------------------------- | --------------------------------------------------------------------------- |
| `001_add_receipt_note.sql`        | An additive, nullable column is recorded. No implemented risk rule matches. |
| `002_drop_legacy_tier.sql`        | PG002 flags possible use of the dropped column by an earlier release.       |
| `003_rename_customer_name.sql`    | PG003 flags the rename for compatibility review.                            |
| `004_require_order_reference.sql` | PG005 and PG007 flag write and locking risks.                               |
| `005_restart_order_sequence.sql`  | PG900 marks the sequence change as requiring manual review.                 |
