import { Pool } from "pg";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const result = await pool.query("delete from conversation_turns where expires_at<=clock_timestamp()");
  console.log(JSON.stringify({ expiredConversationMessagesRemoved: result.rowCount }));
} finally { await pool.end(); }
