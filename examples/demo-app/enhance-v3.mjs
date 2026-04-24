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

function extractSqlFromLogEvent(event) {
  if (!event || typeof event !== "object") return undefined;
  const candidates = [
    event.query?.sql,
    event.query?.query,
    event.query?.text,
    event.query,
    event.sql,
    event.statement,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function extractDurationMsFromLogEvent(event) {
  if (!event || typeof event !== "object") return undefined;
  const candidates = [
    event.queryDurationMillis,
    event.durationMs,
    event.duration,
    event.elapsedMs,
  ];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

export function enhance(_prisma, _ctx, options = {}) {
  const sqlCapture = options.sqlCapture;
  const durationMsCapture = options.durationMsCapture;
  const needsLog =
    Array.isArray(sqlCapture) || Array.isArray(durationMsCapture);
  const log = needsLog
    ? (event) => {
        if (event.level !== "query") return;
        const sql = extractSqlFromLogEvent(event);
        if (Array.isArray(sqlCapture) && sql) {
          sqlCapture.push(sql);
        }
        const durationMs = extractDurationMsFromLogEvent(event);
        if (
          Array.isArray(durationMsCapture) &&
          typeof durationMs === "number"
        ) {
          durationMsCapture.push(durationMs);
        }
      }
    : undefined;

  const benchPglite = getBenchPglite();
  if (benchPglite) {
    return new ZenStackClient(schema, {
      dialect: new PGliteDialect(benchPglite),

      setBasedNestedInclude: true,
      postgresNestedRelationDialect: "cte",
      log: log ?? undefined,
      diagnostics: { slowQueryThresholdMs: 0, timingMaxRecords: Infinity },
    });
  }

  const dbUrl = process.env.DATABASE_URL;

  if (isPostgresUrl(dbUrl)) {
    const pool = getPgPool(dbUrl);
    return new ZenStackClient(schema, {
      dialect: new PostgresDialect({ pool }),
      // setBasedNestedInclude: true,
      // postgresNestedRelationDialect: "cte",
      log: (...args) => {
        // console.log(...args);
        log?.(...args);
      },
      diagnostics: { slowQueryThresholdMs: 0, timingMaxRecords: Infinity },
    });
  }

  const dbPath = resolveSqlitePath();
  const pool = getSqlitePool(dbPath);
  return new ZenStackClient(schema, {
    dialect: new SqliteDialect({ database: pool }),
    setBasedNestedInclude: true,
    postgresNestedRelationDialect: true,
    log: log ?? undefined,
    diagnostics: { slowQueryThresholdMs: 0, timingMaxRecords: Infinity },
  });
}
