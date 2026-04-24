import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type {
  BenchmarkOptions,
  BenchmarkRoundRow,
  BenchmarkRecentQueryTiming,
  BenchmarkSlowQueryTiming,
  BenchmarkTimingStat,
  BenchmarkV3Diagnostics,
} from "./types.js";

const DIAG_CATEGORY_KEYS = [
  "queryTransformMs",
  "nameMappingMs",
  "tempAliasMs",
  "compileMs",
  "compileCacheKeyMs",
  "compileCacheLookupMs",
  "compileCacheStoreMs",
  "dbExecuteMs",
  "pluginOnKyselyMs",
  "mutationHookMs",
  "transactionOverheadMs",
  "executorUntrackedMs",
] as const;

type DiagCategoryKey = (typeof DIAG_CATEGORY_KEYS)[number];

function asFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function safeIso(v: unknown): string | undefined {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  if (typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return undefined;
}

function truncateSql(sql: string, max = 140): string {
  const compact = sql.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}...`;
}

function readDiagnostics(db: unknown): Promise<unknown | null> {
  if (!db || typeof db !== "object") return Promise.resolve(null);
  if (!("$diagnostics" in db)) return Promise.resolve(null);
  try {
    const value = (db as { $diagnostics: unknown }).$diagnostics;
    return Promise.resolve(value ?? null);
  } catch {
    return Promise.resolve(null);
  }
}

function normalizeTimingStat(v: unknown): BenchmarkTimingStat | null {
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;
  const count = asFiniteNumber(obj.count);
  const totalMs = asFiniteNumber(obj.totalMs);
  const maxMs = asFiniteNumber(obj.maxMs);
  if (count === null || totalMs === null || maxMs === null) return null;
  return { count, totalMs, maxMs };
}

function normalizeRecentQueryTiming(v: unknown): BenchmarkRecentQueryTiming | null {
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;
  const sql = typeof obj.sql === "string" ? obj.sql : "";
  const totalMs = asFiniteNumber(obj.totalMs);
  const dbExecuteMs = asFiniteNumber(obj.dbExecuteMs);
  const compileMs = asFiniteNumber(obj.compileMs);
  const queryTransformMs = asFiniteNumber(obj.queryTransformMs);
  if (
    !sql ||
    totalMs === null ||
    dbExecuteMs === null ||
    compileMs === null ||
    queryTransformMs === null
  ) {
    return null;
  }
  return {
    startedAt: safeIso(obj.startedAt),
    sql,
    totalMs,
    dbExecuteMs,
    compileMs,
    queryTransformMs,
    compileCacheHit: Boolean(obj.compileCacheHit),
  };
}

function normalizeSlowQueryTiming(v: unknown): BenchmarkSlowQueryTiming | null {
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;
  const sql = typeof obj.sql === "string" ? obj.sql : "";
  const durationMs = asFiniteNumber(obj.durationMs);
  if (!sql || durationMs === null) return null;
  return { startedAt: safeIso(obj.startedAt), durationMs, sql };
}

function categoryTotal(diag: BenchmarkV3Diagnostics, key: DiagCategoryKey): number {
  return diag.timingCategories[key]?.totalMs ?? 0;
}

function printV3DiagnosticsSummary(rounds: BenchmarkRoundRow[]): void {
  const byId = new Map<string, BenchmarkRoundRow[]>();
  for (const r of rounds) {
    const arr = byId.get(r.id) ?? [];
    arr.push(r);
    byId.set(r.id, arr);
  }
  console.log("");
  console.log("# v3 timing diagnostics (sample: first successful run per query)");
  for (const [id, rs] of [...byId.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    const sample = rs.find((r) => !r.errorV3 && r.v3Diagnostics);
    if (!sample?.v3Diagnostics) continue;
    const diag = sample.v3Diagnostics;
    const label = `${sample.queryName ?? "-"} (${id})`;
    const cat = DIAG_CATEGORY_KEYS.map((k) => `${k}=${categoryTotal(diag, k).toFixed(3)}`).join(", ");
    console.log(`# ${label}`);
    console.log(`  categories: ${cat}`);
    if (!diag.recentQueries.length) {
      console.log("  recent: (none)");
      continue;
    }
    const recent = diag.recentQueries.slice(0, 20);
    console.log("  recent:");
    for (const q of recent) {
      console.log(
        `    total=${q.totalMs.toFixed(3)} db=${q.dbExecuteMs.toFixed(3)} compile=${q.compileMs.toFixed(3)} transform=${q.queryTransformMs.toFixed(3)} cacheHit=${q.compileCacheHit ? "Y" : "N"} sql=${truncateSql(q.sql, 120)}`
      );
    }
  }
}

function captureWorkerDiagnostics(
  diagnostics: unknown,
  runStartMs: number
): BenchmarkV3Diagnostics | null {
  if (!diagnostics || typeof diagnostics !== "object") return null;
  const obj = diagnostics as Record<string, unknown>;
  const timing = obj.timing;
  if (!timing || typeof timing !== "object") return null;
  const timingObj = timing as Record<string, unknown>;
  const categoriesObj =
    timingObj.categories && typeof timingObj.categories === "object"
      ? (timingObj.categories as Record<string, unknown>)
      : {};
  const timingCategories: BenchmarkV3Diagnostics["timingCategories"] = {};
  for (const key of DIAG_CATEGORY_KEYS) {
    const stat = normalizeTimingStat(categoriesObj[key]);
    if (stat) timingCategories[key] = stat;
  }
  const recentArr = Array.isArray(timingObj.recentQueries)
    ? timingObj.recentQueries
    : [];
  const recentQueries = recentArr
    .map(normalizeRecentQueryTiming)
    .filter((x): x is BenchmarkRecentQueryTiming => x !== null)
    .filter((x) => {
      if (!x.startedAt) return true;
      const ts = Date.parse(x.startedAt);
      return Number.isNaN(ts) || ts >= runStartMs - 1;
    });

  const slowArr = Array.isArray(obj.slowQueries) ? obj.slowQueries : [];
  const slowQueries = slowArr
    .map(normalizeSlowQueryTiming)
    .filter((x): x is BenchmarkSlowQueryTiming => x !== null)
    .filter((x) => {
      if (!x.startedAt) return true;
      const ts = Date.parse(x.startedAt);
      return Number.isNaN(ts) || ts >= runStartMs - 1;
    });

  return {
    timingCategories,
    recentQueries,
    slowQueries,
  };
}

function mergeDiagnostics(
  workerDiags: Array<BenchmarkV3Diagnostics | null>
): BenchmarkV3Diagnostics | null {
  const valid = workerDiags.filter((d): d is BenchmarkV3Diagnostics => !!d);
  if (!valid.length) return null;
  const timingCategories: BenchmarkV3Diagnostics["timingCategories"] = {};
  for (const key of DIAG_CATEGORY_KEYS) {
    let hasAny = false;
    let count = 0;
    let totalMs = 0;
    let maxMs = 0;
    for (const d of valid) {
      const stat = d.timingCategories[key];
      if (!stat) continue;
      hasAny = true;
      count += stat.count;
      totalMs += stat.totalMs;
      maxMs = Math.max(maxMs, stat.maxMs);
    }
    if (hasAny) timingCategories[key] = { count, totalMs, maxMs };
  }
  const recentQueries = valid
    .flatMap((d) => d.recentQueries)
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, 20);
  const slowQueries = valid
    .flatMap((d) => d.slowQueries ?? [])
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 20);
  return { timingCategories, recentQueries, slowQueries };
}

export function summarizeMs(values: number[]): {
  n: number;
  mean: number;
  median: number;
  p95: number;
  min: number;
  max: number;
} {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) {
    return { n: 0, mean: 0, median: 0, p95: 0, min: 0, max: 0 };
  }
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const mid = Math.floor(n / 2);
  const median =
    n % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  const p95Idx = Math.min(n - 1, Math.ceil(n * 0.95) - 1);
  const p95 = sorted[p95Idx]!;
  return {
    n,
    mean,
    median,
    p95,
    min: sorted[0]!,
    max: sorted[n - 1]!,
  };
}

/** Human-readable TSV summary (or JSON when `json` is true). */
export function printBenchmarkSummary(
  rounds: BenchmarkRoundRow[],
  json: boolean,
  opts?: { concurrency?: number }
): void {
  if (json) {
    const c = opts?.concurrency ?? 1;
    if (c > 1) {
      console.log(JSON.stringify({ concurrency: c, rounds }, null, 2));
    } else {
      console.log(JSON.stringify(rounds, null, 2));
    }
    return;
  }

  const c = opts?.concurrency ?? 1;
  if (c > 1) {
    console.log(
      `# concurrency=${c}: each iteration runs ${c} parallel copies per side; wall_* = batch completion time; sql/db totals summed across copies.`
    );
  }

  const byId = new Map<string, BenchmarkRoundRow[]>();
  for (const r of rounds) {
    const arr = byId.get(r.id) ?? [];
    arr.push(r);
    byId.set(r.id, arr);
  }

  const columns = [
    { key: "queryId", width: 16, align: "left" as const },
    { key: "queryName", width: 32, align: "left" as const },
    { key: "v2_wall_med", width: 11, align: "right" as const },
    { key: "v2_db_med", width: 9, align: "right" as const },
    { key: "v2_js_med", width: 9, align: "right" as const },
    { key: "v3_wall_med", width: 11, align: "right" as const },
    { key: "v3_db_med", width: 9, align: "right" as const },
    { key: "v3_js_med", width: 9, align: "right" as const },
    { key: "ratio_v3/v2_wall", width: 16, align: "right" as const },
    { key: "v2_sql_n", width: 8, align: "right" as const },
    { key: "v3_sql_n", width: 8, align: "right" as const },
    { key: "errors", width: 6, align: "left" as const },
  ];
  const formatCell = (
    value: string,
    width: number,
    align: "left" | "right"
  ): string => {
    if (value.length >= width) return value;
    return align === "right" ? value.padStart(width) : value.padEnd(width);
  };
  const formatRow = (values: string[]): string =>
    values
      .map((value, i) => formatCell(value, columns[i]!.width, columns[i]!.align))
      .join("  ");

  console.log(formatRow(columns.map((c) => c.key)));
  for (const [id, rs] of [...byId.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    const v2ok = rs.filter((x) => !x.errorV2).map((x) => x.v2Ms);
    const v3ok = rs.filter((x) => !x.errorV3).map((x) => x.v3Ms);
    const v2DbOk = rs
      .filter((x) => !x.errorV2 && x.v2DbMs !== null)
      .map((x) => x.v2DbMs!);
    const v2JsOk = rs
      .filter((x) => !x.errorV2 && x.v2JsMs !== null)
      .map((x) => x.v2JsMs!);
    const v3DbOk = rs
      .filter((x) => !x.errorV3 && x.v3DbMs !== null)
      .map((x) => x.v3DbMs!);
    const v3JsOk = rs
      .filter((x) => !x.errorV3 && x.v3JsMs !== null)
      .map((x) => x.v3JsMs!);
    const s2 = summarizeMs(v2ok);
    const s3 = summarizeMs(v3ok);
    const s2db = summarizeMs(v2DbOk);
    const s2js = summarizeMs(v2JsOk);
    const s3db = summarizeMs(v3DbOk);
    const s3js = summarizeMs(v3JsOk);
    const ratio =
      s2.median > 0 && s3.median > 0
        ? (s3.median / s2.median).toFixed(3)
        : "n/a";
    const err = rs.some((x) => x.errorV2 || x.errorV3) ? "yes" : "no";
    const sql2Row = rs.find((x) => !x.errorV2);
    const sql3Row = rs.find((x) => !x.errorV3);
    const sql2 = sql2Row?.v2SqlCount ?? 0;
    const sql3 = sql3Row?.v3SqlCount ?? 0;
    const fmt = (
      s: ReturnType<typeof summarizeMs>,
      opts?: { showSubMsHint?: boolean }
    ) => {
      if (s.n === 0) return "n/a";
      if (opts?.showSubMsHint && s.median === 0) return "<1ms";
      return s.median.toFixed(3);
    };
    console.log(
      formatRow([
        id,
        rs[0]?.queryName ?? "-",
        s2.median.toFixed(3),
        fmt(s2db, { showSubMsHint: true }),
        fmt(s2js),
        s3.median.toFixed(3),
        fmt(s3db, { showSubMsHint: true }),
        fmt(s3js),
        ratio,
        String(sql2),
        String(sql3),
        err,
      ])
    );
  }

  console.log("");
  console.log(
    "# db_* = summed engine-reported SQL time (Prisma `duration`, Kysely `queryDurationMillis`); may round to 0 on very fast queries."
  );
  console.log(
    "# js_* = wall_* - db_* (client/ORM work + any gap vs reported DB time), clamped at 0."
  );
  if (c > 1) {
    console.log(
      "# With concurrency>1, db_* sums durations across parallel workers — can exceed wall_* because DB work overlaps in time."
    );
  }
  printV3DiagnosticsSummary(rounds);
}

function prismaQueryFromEvent(e: unknown): string {
  if (e && typeof e === "object" && "query" in e) {
    return String((e as { query: unknown }).query);
  }
  return String(e);
}

function prismaQueryDurationMs(e: unknown): number {
  if (e && typeof e === "object" && "duration" in e) {
    const d = (e as { duration: unknown }).duration;
    if (typeof d === "number" && !Number.isNaN(d)) return d;
  }
  return 0;
}

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

function nowMs(): number {
  const h = process.hrtime.bigint();
  return Number(h) / 1e6;
}

/**
 * Interleaved v2/v3 timing per iteration (same order as a fair A/B round).
 * Each side gets a fresh enhance() wrapper; Prisma connection is reused.
 */
export async function runBenchmark(
  options: BenchmarkOptions
): Promise<BenchmarkRoundRow[]> {
  const cwd = path.resolve(options.cwd);

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
      opts?: { sqlCapture?: string[]; durationMsCapture?: number[] }
    ) => Record<string, unknown> & { $diagnostics?: Promise<unknown> };
  };

  const queriesMod = (await importFromProject(options.queriesModule, cwd)) as {
    zenstackCompareQueries: Record<
      string,
      {
        meta: { id: string; file?: string; functionName?: string };
        run: (
          db: unknown,
          queryArgs?: Record<string, unknown>
        ) => Promise<unknown>;
      }
    >;
    zenstackCompareQueryList: Array<{
      meta: { id: string; file: string; functionName?: string };
      run: (
        db: unknown,
        queryArgs?: Record<string, unknown>
      ) => Promise<unknown>;
    }>;
  };

  type PrismaBench = {
    $connect: () => Promise<void>;
    $disconnect: () => Promise<void>;
    $on: (event: string, cb: (e: unknown) => void) => void;
  };

  let prisma: PrismaBench;
  if (options.prismaFactory) {
    prisma = await options.prismaFactory();
  } else {
    const prismaMod = (await importFromProject(
      options.prismaClientSpecifier,
      cwd
    )) as { PrismaClient: new (args?: object) => unknown };
    const PrismaClient = prismaMod.PrismaClient as new (args?: object) => PrismaBench;
    prisma = new PrismaClient({
      log: [{ level: "query", emit: "event" }],
    });
  }

  const sqlCaptureV2: string[] = [];
  let prismaDbDurationAccV2 = 0;
  prisma.$on("query", (e: unknown) => {
    sqlCaptureV2.push(prismaQueryFromEvent(e));
    prismaDbDurationAccV2 += prismaQueryDurationMs(e);
  });

  await prisma.$connect();

  const concurrency = Math.max(1, options.concurrency ?? 1);

  /** One v2 wrapper for the whole run (steady-state; avoids re-creating enhancement each query). */
  const dbV2 = enhanceV2.enhance(prisma, undefined, undefined) as unknown;

  /** v3: one client per concurrent worker so Kysely log arrays stay isolated. */
  const dbV3Workers: Array<{
    db: unknown & { $diagnostics?: Promise<unknown> };
    sqlCapture: string[];
    durationMsCapture: number[];
  }> = Array.from({ length: concurrency }, () => {
    const sqlCapture: string[] = [];
    const durationMsCapture: number[] = [];
    const db = enhanceV3.enhance(prisma, undefined, {
      sqlCapture,
      durationMsCapture,
    }) as unknown as { $diagnostics?: Promise<unknown> };
    return { db, sqlCapture, durationMsCapture };
  });

  const fixtures = options.queryFixtures ?? {};
  const list: Array<{
    meta: { id: string; file?: string; functionName?: string };
    run: (
      db: unknown,
      queryArgs?: Record<string, unknown>
    ) => Promise<unknown>;
  }> = [];

  if (options.queryIds.length) {
    for (const id of options.queryIds) {
      const b = queriesMod.zenstackCompareQueries[id];
      if (b) list.push(b);
    }
  } else {
    let all = queriesMod.zenstackCompareQueryList;
    const subs =
      options.queryIdFilePathSubstrings?.length ?
        options.queryIdFilePathSubstrings
      : options.queryIdFilePathSubstring ?
        [options.queryIdFilePathSubstring]
      : [];
    if (subs.length) {
      all = all.filter((q) => subs.some((s) => q.meta.file.includes(s)));
    }
    list.push(...all);
  }

  if (options.queryNames?.length) {
    const wantedNames = new Set(options.queryNames);
    const filtered = list.filter((q) =>
      q.meta.functionName ? wantedNames.has(q.meta.functionName) : false
    );
    list.length = 0;
    list.push(...filtered);
  }

  const rounds: BenchmarkRoundRow[] = [];

  for (let idx = 0; idx < list.length; idx++) {
    const bundle = list[idx]!;
    const id = bundle.meta.id;
    const queryName = bundle.meta.functionName;
    const queryArgs = fixtures[id];
    const progressLabel = `[benchmark ${idx + 1}/${list.length}] ${queryName ?? "(unnamed)"} (${id})`;
    console.error(`${progressLabel} starting`);

    for (let w = 0; w < options.warmups; w++) {
      sqlCaptureV2.length = 0;
      prismaDbDurationAccV2 = 0;
      for (const wr of dbV3Workers) {
        wr.sqlCapture.length = 0;
        wr.durationMsCapture.length = 0;
      }
      try {
        await Promise.all(
          Array.from({ length: concurrency }, () =>
            bundle.run(dbV2, queryArgs)
          )
        );
      } catch {
        /* warm-up errors ignored */
      }
      for (const wr of dbV3Workers) {
        wr.sqlCapture.length = 0;
        wr.durationMsCapture.length = 0;
      }
      try {
        await Promise.all(
          dbV3Workers.map((wr) => bundle.run(wr.db, queryArgs))
        );
      } catch {
        /* warm-up errors ignored */
      }
    }

    for (let i = 0; i < options.iterations; i++) {
      let errorV2: string | null = null;
      let errorV3: string | null = null;
      let v2Ms = 0;
      let v3Ms = 0;
      let v2SqlCount = 0;
      let v3SqlCount = 0;
      let v2DbMs: number | null = null;
      let v3DbMs: number | null = null;
      let v2JsMs: number | null = null;
      let v3JsMs: number | null = null;
      let v3Diagnostics: BenchmarkV3Diagnostics | null = null;

      sqlCaptureV2.length = 0;
      prismaDbDurationAccV2 = 0;
      const t2a = nowMs();
      try {
        await Promise.all(
          Array.from({ length: concurrency }, () =>
            bundle.run(dbV2, queryArgs)
          )
        );
        const wallEnd = nowMs();
        v2Ms = wallEnd - t2a;
        v2SqlCount = sqlCaptureV2.length;
        v2DbMs = prismaDbDurationAccV2;
        v2JsMs = Math.max(0, v2Ms - v2DbMs);
      } catch (e) {
        errorV2 = e instanceof Error ? e.message : String(e);
        v2Ms = nowMs() - t2a;
        v2DbMs = null;
        v2JsMs = null;
      }

      for (const wr of dbV3Workers) {
        wr.sqlCapture.length = 0;
        wr.durationMsCapture.length = 0;
      }
      const t3a = nowMs();
      const v3RunStartedAtMs = Date.now();
      try {
        await Promise.all(
          dbV3Workers.map((wr) => bundle.run(wr.db, queryArgs))
        );
        const wallEnd = nowMs();
        v3Ms = wallEnd - t3a;
        v3SqlCount = dbV3Workers.reduce((s, wr) => s + wr.sqlCapture.length, 0);
        v3DbMs = dbV3Workers.reduce(
          (s, wr) =>
            s + wr.durationMsCapture.reduce((a, b) => a + b, 0),
          0
        );
        v3JsMs = Math.max(0, v3Ms - (v3DbMs ?? 0));
        const rawDiags = await Promise.all(
          dbV3Workers.map((wr) => readDiagnostics(wr.db))
        );
        v3Diagnostics = mergeDiagnostics(
          rawDiags.map((d) => captureWorkerDiagnostics(d, v3RunStartedAtMs))
        );
      } catch (e) {
        errorV3 = e instanceof Error ? e.message : String(e);
        v3Ms = nowMs() - t3a;
        v3DbMs = null;
        v3JsMs = null;
        const rawDiags = await Promise.all(
          dbV3Workers.map((wr) => readDiagnostics(wr.db))
        );
        v3Diagnostics = mergeDiagnostics(
          rawDiags.map((d) => captureWorkerDiagnostics(d, v3RunStartedAtMs))
        );
      }

      rounds.push({
        id,
        queryName,
        v2Ms,
        v3Ms,
        v2DbMs,
        v3DbMs,
        v2JsMs,
        v3JsMs,
        v2SqlCount,
        v3SqlCount,
        v3Diagnostics,
        errorV2,
        errorV3,
      });
    }
    console.error(`${progressLabel} done`);
  }

  await prisma.$disconnect();
  return rounds;
}
