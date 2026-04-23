/**
 * ZenStack v3 ORM: Kysely ZenStackClient sharing DATABASE_URL with Prisma.
 * - postgresql:// or postgres:// → pg Pool + PostgresDialect
 * - file:... or unset → better-sqlite3 + SqliteDialect (local dev fallback)
 * SQL is captured via Kysely `log` into `options.sqlCapture` (compare runner).
 */
import Database from "better-sqlite3";
import pg from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteDialect } from "@zenstackhq/orm/dialects/sqlite";
import { PostgresDialect } from "@zenstackhq/orm/dialects/postgres";
import { PGliteDialect } from "kysely-pglite-dialect";
import { ZenStackClient } from "@zenstackhq/orm";
import { schema } from "./zenstack/out/schema.js";

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;

function isPostgresUrl(url) {
  return (
    typeof url === "string" &&
    (url.startsWith("postgresql:") || url.startsWith("postgres:"))
  );
}

function resolveSqlitePath() {
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv?.startsWith("file:")) {
    const raw = fromEnv.slice("file:".length);
    return path.isAbsolute(raw) ? raw : path.resolve(root, raw);
  }
  return path.join(root, "prisma", "dev.db");
}

/** @type {Map<string, import('better-sqlite3').Database>} */
const sqlitePools = new Map();
/** @type {Map<string, import('pg').Pool>} */
const pgPools = new Map();

function getSqlitePool(dbPath) {
  let p = sqlitePools.get(dbPath);
  if (!p) {
    p = new Database(dbPath);
    sqlitePools.set(dbPath, p);
  }
  return p;
}

function getPgPool(connectionString) {
  let p = pgPools.get(connectionString);
  if (!p) {
    p = new Pool({ connectionString });
    pgPools.set(connectionString, p);
  }
  return p;
}

function getBenchPglite() {
  if (process.env.ZS_PGLITE_MODE !== "1") return null;
  const g = globalThis;
  return g.__zenstackBenchPglite ?? null;
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

  const benchPglite = getBenchPglite();
  if (benchPglite) {
    return new ZenStackClient(schema, {
      dialect: new PGliteDialect(benchPglite),
      log: log ?? undefined,
    });
  }

  const dbUrl = process.env.DATABASE_URL;

  if (isPostgresUrl(dbUrl)) {
    const pool = getPgPool(dbUrl);
    return new ZenStackClient(schema, {
      dialect: new PostgresDialect({ pool }),
      log: log ?? undefined,
    });
  }

  const dbPath = resolveSqlitePath();
  const pool = getSqlitePool(dbPath);
  return new ZenStackClient(schema, {
    dialect: new SqliteDialect({ database: pool }),
    log: log ?? undefined,
  });
}
