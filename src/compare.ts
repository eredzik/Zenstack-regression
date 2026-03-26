import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { CompareOptions } from "./types.js";

export type CompareRow = {
  id: string;
  ok: boolean;
  sqlV2: string[];
  sqlV3: string[];
  sqlMatch: boolean;
  resultV2Json: string | null;
  resultV3Json: string | null;
  /** Rows returned: array length, or 1 for a single object, 0 for null. Null if that side errored. */
  recordCountV2: number | null;
  recordCountV3: number | null;
  recordCountsMatch: boolean;
  resultsMatch: boolean;
  errorV2: string | null;
  errorV3: string | null;
};

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v === "undefined") return v;
    if (typeof v === "bigint") return v.toString();
    if (typeof v !== "object") return v;
    if (v instanceof Date) return v.toISOString();
    if (typeof (v as { toJSON?: () => unknown }).toJSON === "function") {
      try {
        return walk((v as { toJSON: () => unknown }).toJSON());
      } catch {
        /* fall through */
      }
    }
    if (Array.isArray(v)) return v.map(walk);
    if (seen.has(v as object)) return "[Circular]";
    seen.add(v as object);
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = walk(obj[k]);
    return out;
  };
  return JSON.stringify(walk(value));
}

function normalizeSql(lines: string[]): string {
  return lines
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ; ");
}

function prismaQueryFromEvent(e: unknown): string {
  if (e && typeof e === "object" && "query" in e) {
    return String((e as { query: unknown }).query);
  }
  return String(e);
}

/**
 * Interpret Prisma-style results as a "record count" for reporting.
 * - findMany / groupBy: array length
 * - findFirst / findUnique / single entity or aggregate object: 1
 * - null: 0
 */
export function countResultRecords(value: unknown): number {
  if (value === null || typeof value === "undefined") return 0;
  if (Array.isArray(value)) return value.length;
  return 1;
}

/** Resolve imports from the target project (--cwd) so @prisma/client loads from example app node_modules. */
async function importFromProject(
  specifier: string,
  cwd: string
): Promise<unknown> {
  if (specifier.startsWith("file:")) {
    return import(specifier);
  }
  if (
    specifier.startsWith(".") ||
    path.isAbsolute(specifier) ||
    /^[a-zA-Z]:[\\/]/.test(specifier)
  ) {
    const abs = path.isAbsolute(specifier)
      ? specifier
      : path.resolve(cwd, specifier);
    return import(pathToFileURL(abs).href);
  }
  const req = createRequire(path.join(cwd, "package.json"));
  const resolved = req.resolve(specifier);
  return import(pathToFileURL(resolved).href);
}

export async function runCompare(options: CompareOptions): Promise<CompareRow[]> {
  const cwd = path.resolve(options.cwd);
  const prismaMod = (await importFromProject(
    options.prismaClientSpecifier,
    cwd
  )) as { PrismaClient: new (args?: object) => unknown };
  const PrismaClient = prismaMod.PrismaClient as new (args?: object) => {
    $connect: () => Promise<void>;
    $disconnect: () => Promise<void>;
    $on: (event: string, cb: (e: unknown) => void) => void;
  };

  const enhanceV2 = (await importFromProject(
    options.enhanceV2Module,
    cwd
  )) as {
    enhance: (
      prisma: unknown,
      ctx?: unknown,
      opts?: unknown
    ) => Record<string, unknown>;
  };
  const enhanceV3 = (await importFromProject(
    options.enhanceV3Module,
    cwd
  )) as {
    enhance: (
      prisma: unknown,
      ctx?: unknown,
      opts?: { sqlCapture?: string[] }
    ) => Record<string, unknown>;
  };

  const queriesMod = (await importFromProject(options.queriesModule, cwd)) as {
    zenstackCompareQueries: Record<
      string,
      {
        meta: { id: string };
        run: (
          db: unknown,
          queryArgs?: Record<string, unknown>
        ) => Promise<unknown>;
      }
    >;
    zenstackCompareQueryList: Array<{
      meta: { id: string };
      run: (
        db: unknown,
        queryArgs?: Record<string, unknown>
      ) => Promise<unknown>;
    }>;
  };

  const prisma = new PrismaClient({
    log: [{ level: "query", emit: "event" }],
  });

  /** Prisma query log for the current "v2" side (enhanced Prisma). */
  const sqlCaptureV2: string[] = [];
  prisma.$on("query", (e: unknown) => {
    sqlCaptureV2.push(prismaQueryFromEvent(e));
  });

  await prisma.$connect();

  const rows: CompareRow[] = [];
  const fixtures = options.queryFixtures ?? {};

  const list: Array<{
    meta: { id: string };
    run: (
      db: unknown,
      queryArgs?: Record<string, unknown>
    ) => Promise<unknown>;
  }> = [];

  if (options.queryIds?.length) {
    for (const id of options.queryIds) {
      const b = queriesMod.zenstackCompareQueries[id];
      if (b) list.push(b);
    }
  } else {
    list.push(...queriesMod.zenstackCompareQueryList);
  }

  for (const bundle of list) {
    const id = bundle.meta.id;
    const sqlV2: string[] = [];
    const sqlV3: string[] = [];

    let errorV2: string | null = null;
    let errorV3: string | null = null;
    let resultV2: unknown;
    let resultV3: unknown;

    const queryArgs = fixtures[id];

    try {
      const db2 = enhanceV2.enhance(prisma, undefined, undefined) as unknown;
      sqlCaptureV2.length = 0;
      resultV2 = await bundle.run(db2, queryArgs);
      sqlV2.push(...sqlCaptureV2);
    } catch (e) {
      errorV2 = e instanceof Error ? e.message : String(e);
    }

    try {
      const sqlCaptureV3: string[] = [];
      const db3 = enhanceV3.enhance(prisma, undefined, {
        sqlCapture: sqlCaptureV3,
      }) as unknown;
      resultV3 = await bundle.run(db3, queryArgs);
      sqlV3.push(...sqlCaptureV3);
    } catch (e) {
      errorV3 = e instanceof Error ? e.message : String(e);
    }

    const resultV2Json = errorV2 === null ? stableStringify(resultV2) : null;
    const resultV3Json = errorV3 === null ? stableStringify(resultV3) : null;
    const recordCountV2 =
      errorV2 === null ? countResultRecords(resultV2) : null;
    const recordCountV3 =
      errorV3 === null ? countResultRecords(resultV3) : null;
    const recordCountsMatch =
      recordCountV2 !== null &&
      recordCountV3 !== null &&
      recordCountV2 === recordCountV3;
    const resultsMatch =
      errorV2 === null && errorV3 === null && resultV2Json === resultV3Json;
    const sqlMatch = normalizeSql(sqlV2) === normalizeSql(sqlV3);
    const noErrors = errorV2 === null && errorV3 === null;
    const ok = options.ignoreSqlDiff
      ? resultsMatch && noErrors
      : resultsMatch && sqlMatch && noErrors;

    rows.push({
      id,
      ok,
      sqlV2,
      sqlV3,
      sqlMatch,
      resultV2Json,
      resultV3Json,
      recordCountV2,
      recordCountV3,
      recordCountsMatch,
      resultsMatch,
      errorV2,
      errorV3,
    });
  }

  await prisma.$disconnect();

  if (options.silent) {
    return rows;
  }

  if (!options.json) {
    for (const r of rows) {
      const status = r.ok ? "OK" : "DIFF";
      console.log(`[${status}] ${r.id}`);
      const c2 =
        r.recordCountV2 === null ? "n/a" : String(r.recordCountV2);
      const c3 =
        r.recordCountV3 === null ? "n/a" : String(r.recordCountV3);
      console.log(`  records v2: ${c2}  v3: ${c3}`);
      if (!r.sqlMatch) {
        console.log("  SQL v2:", r.sqlV2.join(" | "));
        console.log("  SQL v3:", r.sqlV3.join(" | "));
      }
      if (!r.resultsMatch) {
        console.log("  result v2:", r.resultV2Json ?? r.errorV2);
        console.log("  result v3:", r.resultV3Json ?? r.errorV3);
      }
    }
  } else {
    console.log(JSON.stringify(rows, null, 2));
  }

  return rows;
}
