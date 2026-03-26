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
