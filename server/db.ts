import { Pool } from "pg";

// Railway injects DATABASE_URL automatically when Postgres addon is added.
// Falls back gracefully if not yet configured so the app still boots.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("railway")
    ? { rejectUnauthorized: false }
    : false,
});

export const db = {
  query: (text: string, params?: any[]) => pool.query(text, params),

  // Convenience: return first row or null
  queryOne: async (text: string, params?: any[]) => {
    const result = await pool.query(text, params);
    return result.rows[0] ?? null;
  },
};

// Test connection on startup — non-fatal if DB not yet configured
pool.connect()
  .then(client => {
    console.log("[DB] PostgreSQL connected");
    client.release();
  })
  .catch(err => {
    console.warn("[DB] PostgreSQL not available (expected until Railway Postgres addon added):", err.message);
  });

export default pool;
