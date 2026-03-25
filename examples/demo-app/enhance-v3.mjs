/**
 * ZenStack v3 ORM: Kysely-based ZenStackClient (same DB file as Prisma SQLite).
 * SQL is captured via Kysely `log` into `options.sqlCapture` (filled by compare runner).
 */
import Database from "better-sqlite3";
import { SqliteDialect } from "@zenstackhq/orm/dialects/sqlite";
import { ZenStackClient } from "@zenstackhq/orm";
import { schema } from "./zenstack/out/schema.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;

function resolveDbPath() {
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv?.startsWith("file:")) {
    const raw = fromEnv.slice("file:".length);
    return path.isAbsolute(raw) ? raw : path.resolve(root, raw);
  }
  return path.join(root, "prisma", "dev.db");
}

const dbPath = resolveDbPath();

/** @type {Map<string, Database.Database>} */
const pools = new Map();

function getPool(key) {
  let p = pools.get(key);
  if (!p) {
    p = new Database(dbPath);
    pools.set(key, p);
  }
  return p;
}

export function enhance(_prisma, _ctx, options = {}) {
  const sqlCapture = options.sqlCapture;
  const log =
    Array.isArray(sqlCapture) ?
      (event) => {
        if (event.level === "query" && event.query?.sql) {
          sqlCapture.push(String(event.query.sql).trim());
        }
      }
    : undefined;

  const pool = getPool(dbPath);
  return new ZenStackClient(schema, {
    dialect: new SqliteDialect({ database: pool }),
    // Kysely: either `['query']` or a custom Logger callback — not both in one value.
    log: log ?? undefined,
  });
}
