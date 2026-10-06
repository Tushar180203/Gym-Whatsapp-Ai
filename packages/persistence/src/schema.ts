// The deterministic vertical slice uses the SQL migration in migrations/0001_vertical_slice.sql
// as the database contract. Drizzle is selected for typed relational access and will own
// generated schema declarations as the Postgres-backed repository is expanded.
export const schemaReady = true;
