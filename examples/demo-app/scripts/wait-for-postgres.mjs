/**
 * Wait until PostgreSQL accepts connections (for docker compose health + race).
 */
import pg from "pg";

const url =
  process.env.DATABASE_URL ||
  "postgresql://demo:demo@127.0.0.1:5433/zenstack_compare_demo";
const maxAttempts = 60;
const delayMs = 1000;

for (let i = 0; i < maxAttempts; i++) {
  const c = new pg.Client({ connectionString: url });
  try {
    await c.connect();
    await c.end();
    console.log("PostgreSQL is ready.");
    process.exit(0);
  } catch {
    try {
      await c.end();
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

console.error("PostgreSQL did not become ready in time:", url);
process.exit(1);
