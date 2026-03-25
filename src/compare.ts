import type { CompareOptions } from "./types.js";

export type CompareRow = {
  id: string;
  ok: boolean;
  sqlV2: string[];
  sqlV3: string[];
  sqlMatch: boolean;
  resultV2Json: string | null;
  resultV3Json: string | null;
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

export async function runCompare(options: CompareOptions): Promise<CompareRow[]> {
  const prismaMod = await import(options.prismaClientSpecifier);
  const PrismaClient = prismaMod.PrismaClient as new (args?: object) => {
    $connect: () => Promise<void>;
    $disconnect: () => Promise<void>;
    $on: (event: string, cb: (e: unknown) => void) => void;
  };

  const enhanceV2 = (await import(options.enhanceV2Module)) as {
    enhance: (
      prisma: unknown,
      ctx?: unknown,
      opts?: unknown
    ) => Record<string, unknown>;
  };
  const enhanceV3 = (await import(options.enhanceV3Module)) as {
    enhance: (
      prisma: unknown,
      ctx?: unknown,
      opts?: unknown
    ) => Record<string, unknown>;
  };

  const queriesMod = (await import(options.queriesModule)) as {
    zenstackCompareQueries: Record<
      string,
      { meta: { id: string }; run: (db: unknown) => Promise<unknown> }
    >;
    zenstackCompareQueryList: Array<{
      meta: { id: string };
      run: (db: unknown) => Promise<unknown>;
    }>;
  };

  const prisma = new PrismaClient({
    log: [{ level: "query", emit: "event" }],
  });

  const sqlCapture: string[] = [];
  prisma.$on("query", (e: unknown) => {
    sqlCapture.push(prismaQueryFromEvent(e));
  });

  await prisma.$connect();

  const rows: CompareRow[] = [];
  const list: Array<{
    meta: { id: string };
    run: (db: unknown) => Promise<unknown>;
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

    try {
      const db2 = enhanceV2.enhance(prisma, undefined, undefined) as unknown;
      sqlCapture.length = 0;
      resultV2 = await bundle.run(db2);
      sqlV2.push(...sqlCapture);
    } catch (e) {
      errorV2 = e instanceof Error ? e.message : String(e);
    }

    try {
      const db3 = enhanceV3.enhance(prisma, undefined, undefined) as unknown;
      sqlCapture.length = 0;
      resultV3 = await bundle.run(db3);
      sqlV3.push(...sqlCapture);
    } catch (e) {
      errorV3 = e instanceof Error ? e.message : String(e);
    }

    const resultV2Json = errorV2 === null ? stableStringify(resultV2) : null;
    const resultV3Json = errorV3 === null ? stableStringify(resultV3) : null;
    const resultsMatch =
      errorV2 === null && errorV3 === null && resultV2Json === resultV3Json;
    const sqlMatch = normalizeSql(sqlV2) === normalizeSql(sqlV3);
    const ok = resultsMatch && sqlMatch && errorV2 === null && errorV3 === null;

    rows.push({
      id,
      ok,
      sqlV2,
      sqlV3,
      sqlMatch,
      resultV2Json,
      resultV3Json,
      resultsMatch,
      errorV2,
      errorV3,
    });
  }

  await prisma.$disconnect();

  if (!options.json) {
    for (const r of rows) {
      const status = r.ok ? "OK" : "DIFF";
      console.log(`[${status}] ${r.id}`);
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
