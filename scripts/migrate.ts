import { PostgresVerticalSliceApp } from "../packages/persistence/src/postgres.js";
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for migration");
const app = new PostgresVerticalSliceApp({ connectionString });
try { await app.migrate(); console.info("Ordered migrations applied successfully (configuration redacted)."); }
catch { console.error("Migration failed. No migration was committed; inspect database constraints with an authorized operator."); process.exitCode = 1; }
finally { await app.close(); }
