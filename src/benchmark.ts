import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { BenchmarkOptions, BenchmarkRoundRow } from "./types.js";

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
  json: boolean
): void {
  if (json) {
    console.log(JSON.stringify(rounds, null, 2));
    return;
  }

  const byId = new Map<string, BenchmarkRoundRow[]>();
  for (const r of rounds) {
    const arr = byId.get(r.id) ?? [];
    arr.push(r);
    byId.set(r.id, arr);
  }

  console.log(
    "queryId\tv2_wall_med\tv2_db_med\tv2_js_med\tv3_wall_med\tv3_db_med\tv3_js_med\tratio_v3/v2_wall\tv2_sql_n\tv3_sql_n\terrors"
  );
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
    const fmt = (s: ReturnType<typeof summarizeMs>) =>
      s.n === 0 ? "n/a" : s.median.toFixed(3);
    console.log(
      `${id}\t${s2.median.toFixed(3)}\t${fmt(s2db)}\t${fmt(s2js)}\t${s3.median.toFixed(3)}\t${fmt(s3db)}\t${fmt(s3js)}\t${ratio}\t${sql2}\t${sql3}\t${err}`
    );
  }

  console.log("");
  console.log(
    "# db_* = summed engine-reported SQL time (Prisma `duration`, Kysely `queryDurationMillis`); may round to 0 on very fast queries."
  );
  console.log(
    "# js_* = wall_* - db_* (client/ORM work + any gap vs reported DB time), clamped at 0."
  );
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
      meta: { id: string; file: string };
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

  /** One v2 wrapper for the whole run (steady-state; avoids re-creating enhancement each query). */
  const dbV2 = enhanceV2.enhance(prisma, undefined, undefined) as unknown;
  const sqlCaptureV3Shared: string[] = [];
  const durationMsCaptureV3: number[] = [];
  const dbV3 = enhanceV3.enhance(prisma, undefined, {
    sqlCapture: sqlCaptureV3Shared,
    durationMsCapture: durationMsCaptureV3,
  }) as unknown;

  const fixtures = options.queryFixtures ?? {};
  const list: Array<{
    meta: { id: string };
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

  const rounds: BenchmarkRoundRow[] = [];

  for (const bundle of list) {
    const id = bundle.meta.id;
    const queryArgs = fixtures[id];

    for (let w = 0; w < options.warmups; w++) {
      sqlCaptureV2.length = 0;
      prismaDbDurationAccV2 = 0;
      try {
        await bundle.run(dbV2, queryArgs);
      } catch {
        /* warm-up errors ignored */
      }
      sqlCaptureV3Shared.length = 0;
      durationMsCaptureV3.length = 0;
      try {
        await bundle.run(dbV3, queryArgs);
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

      sqlCaptureV2.length = 0;
      prismaDbDurationAccV2 = 0;
      const t2a = nowMs();
      try {
        await bundle.run(dbV2, queryArgs);
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

      sqlCaptureV3Shared.length = 0;
      durationMsCaptureV3.length = 0;
      const t3a = nowMs();
      try {
        await bundle.run(dbV3, queryArgs);
        const wallEnd = nowMs();
        v3Ms = wallEnd - t3a;
        v3SqlCount = sqlCaptureV3Shared.length;
        v3DbMs = durationMsCaptureV3.reduce((a, b) => a + b, 0);
        v3JsMs = Math.max(0, v3Ms - v3DbMs);
      } catch (e) {
        errorV3 = e instanceof Error ? e.message : String(e);
        v3Ms = nowMs() - t3a;
        v3DbMs = null;
        v3JsMs = null;
      }

      rounds.push({
        id,
        v2Ms,
        v3Ms,
        v2DbMs,
        v3DbMs,
        v2JsMs,
        v3JsMs,
        v2SqlCount,
        v3SqlCount,
        errorV2,
        errorV3,
      });
    }
  }

  await prisma.$disconnect();
  return rounds;
}
