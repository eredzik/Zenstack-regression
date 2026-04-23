import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { BenchmarkOptions, BenchmarkRoundRow } from "./types.js";

function prismaQueryFromEvent(e: unknown): string {
  if (e && typeof e === "object" && "query" in e) {
    return String((e as { query: unknown }).query);
  }
  return String(e);
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
      meta: { id: string; file: string };
      run: (
        db: unknown,
        queryArgs?: Record<string, unknown>
      ) => Promise<unknown>;
    }>;
  };

  const prisma = new PrismaClient({
    log: [{ level: "query", emit: "event" }],
  });
  const sqlCaptureV2: string[] = [];
  prisma.$on("query", (e: unknown) => {
    sqlCaptureV2.push(prismaQueryFromEvent(e));
  });

  await prisma.$connect();

  /** One v2 wrapper for the whole run (steady-state; avoids re-creating enhancement each query). */
  const dbV2 = enhanceV2.enhance(prisma, undefined, undefined) as unknown;
  const sqlCaptureV3Shared: string[] = [];
  const dbV3 = enhanceV3.enhance(prisma, undefined, {
    sqlCapture: sqlCaptureV3Shared,
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
    if (options.queryIdFilePathSubstring) {
      const sub = options.queryIdFilePathSubstring;
      all = all.filter((q) => q.meta.file.includes(sub));
    }
    list.push(...all);
  }

  const rounds: BenchmarkRoundRow[] = [];

  for (const bundle of list) {
    const id = bundle.meta.id;
    const queryArgs = fixtures[id];

    for (let w = 0; w < options.warmups; w++) {
      sqlCaptureV2.length = 0;
      try {
        await bundle.run(dbV2, queryArgs);
      } catch {
        /* warm-up errors ignored */
      }
      sqlCaptureV3Shared.length = 0;
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

      sqlCaptureV2.length = 0;
      const t2a = nowMs();
      try {
        await bundle.run(dbV2, queryArgs);
        v2SqlCount = sqlCaptureV2.length;
      } catch (e) {
        errorV2 = e instanceof Error ? e.message : String(e);
      }
      v2Ms = nowMs() - t2a;

      sqlCaptureV3Shared.length = 0;
      const t3a = nowMs();
      try {
        await bundle.run(dbV3, queryArgs);
        v3SqlCount = sqlCaptureV3Shared.length;
      } catch (e) {
        errorV3 = e instanceof Error ? e.message : String(e);
      }
      v3Ms = nowMs() - t3a;

      rounds.push({
        id,
        v2Ms,
        v3Ms,
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
