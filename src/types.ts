/** Single extracted call site: db.<model>.<method>(args) */

export interface ExtractedQuery {
  /** Stable id (hash of file + position + model + method) */
  id: string;
  file: string;
  line: number;
  column: number;
  dbAlias: string;
  model: string;
  method: string;
  /** First argument source text, if present */
  arg0Source: string | null;
  /** Full argument list source inside (...) */
  argsSource: string;
}

export interface ExtractManifest {
  version: 1;
  root: string;
  extractedAt: string;
  zmodelFiles: string[];
  /** Relative path -> file text (for audit / reproducing schema in harness) */
  zmodelContents?: Record<string, string>;
  queries: ExtractedQuery[];
}

export interface ExtractOptions {
  root: string;
  include: string[];
  exclude: string[];
  /** Top-level client identifiers, e.g. `db`, `prisma` */
  dbAliases: string[];
  /** Property on `this`, e.g. `this.db` when name is in this list */
  thisPropertyNames: string[];
  /** Transaction client parameters, e.g. `tx` in `$transaction(async (tx) => ...)` */
  transactionAliases: string[];
  prismaQueryMethods: Set<string>;
}

export interface CompareOptions {
  cwd: string;
  queriesModule: string;
  enhanceV2Module: string;
  enhanceV3Module: string;
  prismaClientSpecifier: string;
  queryIds?: string[];
  json: boolean;
  /**
   * When true, `ok` only requires matching results and no errors (SQL strings may differ).
   * Use when comparing Prisma-based v2 vs Kysely-based v3 where SQL text is never identical.
   */
  ignoreSqlDiff?: boolean;
  /** Skip printing to stdout (for programmatic use). */
  silent?: boolean;
  /**
   * Per query id: deep-merge into the extracted Prisma call's first argument.
   * From JSON file: use `loadQueryFixtures` or `--fixtures` on the CLI.
   */
  queryFixtures?: Record<string, Record<string, unknown>>;
}

/** One timed round for a single query id on both ZenStack sides (v2 then v3). */
export interface BenchmarkRoundRow {
  id: string;
  /** Wall-clock time for the full `run()` (ORM + DB + result shaping). */
  v2Ms: number;
  v3Ms: number;
  /**
   * Sum of Prisma engine-reported `duration` (ms) per SQL round-trip in this iteration.
   * Approximates time inside the DB driver / engine for that work unit.
   */
  v2DbMs: number | null;
  /** Sum of Kysely `queryDurationMillis` per logged query (ZenStack v3 / Kysely path). */
  v3DbMs: number | null;
  /**
   * Wall minus summed DB-reported time, clamped at 0. Captures client-side work
   * (serialization, relation assembly, JS overhead). Not perfectly disjoint from DB.
   */
  v2JsMs: number | null;
  v3JsMs: number | null;
  v2SqlCount: number;
  v3SqlCount: number;
  errorV2: string | null;
  errorV3: string | null;
}

export interface BenchmarkOptions {
  cwd: string;
  queriesModule: string;
  enhanceV2Module: string;
  enhanceV3Module: string;
  /**
   * When `prismaFactory` is set, used only if the factory is not provided.
   * Ignored when `prismaFactory` builds the client (e.g. PGlite + adapter).
   */
  prismaClientSpecifier: string;
  /**
   * Optional async factory (e.g. Prisma + PGlite driver adapter). When set,
   * `new PrismaClient()` from `prismaClientSpecifier` is not used.
   */
  prismaFactory?: () => Promise<{
    $connect: () => Promise<void>;
    $disconnect: () => Promise<void>;
    $on: (event: string, cb: (e: unknown) => void) => void;
  }>;
  /** If empty, all queries in the module are benchmarked. */
  queryIds: string[];
  /**
   * If set, only queries whose extracted `file` path includes **any** of these
   * substrings (e.g. `["benchmark-queries", "benchmark-scale"]`).
   */
  queryIdFilePathSubstrings?: string[];
  /** @deprecated Prefer `queryIdFilePathSubstrings`; if set without substrings array, used as single filter. */
  queryIdFilePathSubstring?: string;
  queryFixtures?: Record<string, Record<string, unknown>>;
  warmups: number;
  iterations: number;
  /**
   * How many identical `run()` calls execute in parallel per side per iteration (`Promise.all`).
   * Wall time is batch completion (time until all copies finish). SQL/db metrics are summed
   * across all copies. Omit or 1 = sequential (same as before).
   */
  concurrency?: number;
}
