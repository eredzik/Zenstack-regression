#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, "..");
const repoRoot = path.join(appRoot, "..", "..");

function parseArg(flag, fallback = undefined) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  const val = process.argv[idx + 1];
  if (!val || val.startsWith("--")) return fallback;
  return val;
}

function sqlLiteral(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return `'${String(v).replaceAll("'", "''")}'`;
}

function inlineBind(sql, values) {
  return sql.replace(/\$(\d+)/g, (_m, n) => {
    const idx = Number(n) - 1;
    if (idx < 0 || idx >= values.length) {
      throw new Error(`Missing bind value for $${n}`);
    }
    return sqlLiteral(values[idx]);
  });
}

function maxPlaceholderIndex(sql) {
  let max = 0;
  for (const m of sql.matchAll(/\$(\d+)/g)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

function inferGenericBinds(sql, ctx) {
  const n = maxPlaceholderIndex(sql);
  if (n === 0) return [];
  const values = [];
  for (let i = 1; i <= n; i++) {
    const re = new RegExp(`\\$${i}(?!\\d)`, "g");
    const m = re.exec(sql);
    const pos = m?.index ?? -1;
    const before =
      pos >= 0 ? sql.slice(Math.max(0, pos - 120), pos).toLowerCase() : "";

    if (before.includes(" limit ")) {
      values.push(ctx.postsTake ?? ctx.commentsTake ?? 20);
    } else if (before.includes(" offset ")) {
      values.push(0);
    } else if (before.includes('"authorid"')) {
      values.push(ctx.authorId ?? "u1");
    } else if (before.includes('"org"."id"') || before.includes('"org"."id" =')) {
      values.push(ctx.orgId ?? "org-1");
    } else if (before.includes('"project"."id"')) {
      values.push(ctx.projectId ?? "proj-alpha");
    } else if (before.includes('"user"."id"')) {
      values.push(ctx.authorId ?? "u1");
    } else if (before.includes("<=") || before.includes("take")) {
      values.push(ctx.commentsTake ?? 20);
    } else {
      values.push("x");
    }
  }
  return values;
}

function inferV2Binds(sql, ctx) {
  // Common statements emitted for benchTier6WidePosts80Comments20.
  if (
    sql.includes('"public"."Post"."authorId" = $1') &&
    sql.includes("LIMIT $2")
  ) {
    return [ctx.authorId, ctx.postsTake, 0];
  }
  if (sql.includes('"public"."User"."id" IN ($1)')) {
    return [ctx.authorId, 0];
  }
  if (
    sql.includes('"public"."Comment"."postId" IN (') &&
    sql.includes('"public"."Comment"."postId"')
  ) {
    const n = maxPlaceholderIndex(sql);
    // Shape: IN ($1..$N-1) and OFFSET $N
    const idCount = Math.max(1, n - 1);
    const ids = (ctx.selectedPostIds ?? []).slice(0, idCount);
    const filled =
      ids.length >= idCount
        ? ids
        : [
            ...ids,
            ...Array.from(
              { length: idCount - ids.length },
              () => ctx.postIdForComments,
            ),
          ];
    return [...filled, 0];
  }
  if (
    sql.includes('"public"."User"."id" IN (') &&
    sql.includes('"public"."User"."email"')
  ) {
    const n = maxPlaceholderIndex(sql);
    const idCount = Math.max(1, n - 1);
    const ids = (ctx.commentAuthorIds ?? []).slice(0, idCount);
    const filled =
      ids.length >= idCount
        ? ids
        : [
            ...ids,
            ...Array.from({ length: idCount - ids.length }, () => ctx.authorId),
          ];
    return [...filled, 0];
  }
  if (sql.includes('"public"."Post"."id" IN (')) {
    const n = maxPlaceholderIndex(sql);
    const idCount = Math.max(1, n - 1);
    const ids = (ctx.commentPostIds ?? []).slice(0, idCount);
    const filled =
      ids.length >= idCount
        ? ids
        : [
            ...ids,
            ...Array.from(
              { length: idCount - ids.length },
              () => ctx.postIdForComments,
            ),
          ];
    return [...filled, 0];
  }

  // Fallback: fill all placeholders with 0 (keeps EXPLAIN runnable for unknown shapes).
  return inferGenericBinds(sql, ctx);
}

function inferV3Binds(sql, ctx) {
  // benchTier6WidePosts80Comments20 shape:
  //   $1 -> row_number() limit for comments
  //   $2 -> Post.authorId filter
  //   $3 -> outer LIMIT for posts
  if (sql.includes('"$rn" <= $1') && sql.includes('"Post"."authorId" = $2')) {
    return [ctx.commentsTake, ctx.authorId, ctx.postsTake];
  }

  return inferGenericBinds(sql, ctx);
}

function runCompareJson(queryName) {
  const cmd = [
    "node",
    path.join(repoRoot, "dist", "cli.js"),
    "compare",
    "--cwd",
    appRoot,
    "--prisma-client",
    "./node_modules/.prisma/client/index.js",
    "--queries-dir",
    "./.zenstack-compare/queries",
    "--enhance-v2",
    "./.zenstack-compare/enhance-v2.mjs",
    "--enhance-v3",
    "./enhance-v3.mjs",
    "--query-name",
    queryName,
    "--ignore-sql-diff",
    "--json",
  ];
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", cwd: appRoot });
  if (r.status !== 0) {
    throw new Error(`compare failed:\n${r.stderr || r.stdout}`);
  }
  console.log(r.stdout);
  return JSON.parse(r.stdout);
}

async function explainSql(pool, title, sqlText) {
  const explain = `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT) ${sqlText}`;
  const res = await pool.query(explain);
  console.log(`\n=== ${title} ===`);
  for (const row of res.rows) {
    const line = row["QUERY PLAN"];
    if (line) console.log(line);
  }
}

async function executeSqlOnce(pool, title, sqlText) {
  const t0 = process.hrtime.bigint();
  const res = await pool.query(sqlText);
  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`\n=== ${title} ===`);
  console.log(`rows: ${res.rowCount ?? 0}`);
  console.log(`elapsed_ms: ${elapsedMs.toFixed(3)}`);
}

function presetBinds(queryName) {
  // These benchmark functions use fixed literals; presets make EXPLAIN reproducible.
  if (queryName === "benchTier6WidePosts80Comments20") {
    return {
      preset: true,
      // Dynamic v2 bind inference handles SQL shape drift between ORM versions.
      v2: [],
      context: {
        authorId: "u1",
        orgId: "org-1",
        projectId: "proj-alpha",
        postsTake: 80,
        commentsTake: 20,
        postIdForComments: "p120",
      },
    };
  }
  return {
    preset: false,
    v2: [],
    context: {
      authorId: "u1",
      orgId: "org-1",
      projectId: "proj-alpha",
      postsTake: 20,
      commentsTake: 20,
      postIdForComments: "p1",
    },
  };
}

async function main() {
  const queryName = parseArg("--query-name");
  if (!queryName) {
    console.error(
      "Usage: node scripts/explain-query-plans.mjs --query-name <name>",
    );
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "DATABASE_URL is required (example: postgresql://demo:demo@127.0.0.1:5434/zenstack_compare_demo)",
    );
    process.exit(1);
  }

  const rows = runCompareJson(queryName);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`No compare rows returned for queryName=${queryName}`);
  }
  const row = rows[0];
  const sqlV2 = Array.isArray(row?.sqlV2) ? row.sqlV2 : [];
  const sqlV3 = Array.isArray(row?.sqlV3) ? row.sqlV3 : [];
  const binds = presetBinds(queryName);
  if (!binds.preset) {
    console.log(
      `# no explicit preset for ${queryName}; using generic SQL-based bind inference`,
    );
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    // Build dynamic context from seeded dataset so IN(...) binds match runtime SQL shape.
    const selectedPostsRes = await pool.query(
      `
      SELECT id
      FROM "public"."Post"
      WHERE "authorId" = $1
      ORDER BY sequence DESC
      LIMIT $2
      `,
      [binds.context.authorId, binds.context.postsTake],
    );
    binds.context.selectedPostIds = selectedPostsRes.rows.map((r) => r.id);

    const commentsRes = await pool.query(
      `
      SELECT "postId", "authorId"
      FROM "public"."Comment"
      WHERE "postId" = ANY($1::text[])
      ORDER BY id ASC
      `,
      [binds.context.selectedPostIds],
    );
    binds.context.commentPostIds = [
      ...new Set(commentsRes.rows.map((r) => r.postId)),
    ];
    binds.context.commentAuthorIds = [
      ...new Set(commentsRes.rows.map((r) => r.authorId)),
    ];

    console.log(`# queryName=${queryName}`);
    console.log(`# queryId=${row.id}`);
    console.log(
      `# v2 statements=${sqlV2.length}, v3 statements=${sqlV3.length}`,
    );
    if (sqlV2.length === 0 || sqlV3.length === 0) {
      console.log(`# compare row keys: ${Object.keys(row).join(", ")}`);
    }

    for (let i = 0; i < sqlV2.length; i++) {
      const rawSql = sqlV2[i];
      const inferred = inferV2Binds(rawSql, binds.context ?? {});
      const sql = inlineBind(rawSql, inferred);
      console.log(`\n--- v2 SQL ${i + 1} (raw) ---\n${rawSql}`);
      console.log(`\n--- v2 SQL ${i + 1} (inlined) ---\n${sql}`);
      await explainSql(pool, `v2 SQL ${i + 1}`, sql);
    }

    const rawV3Sql = sqlV3[0];
    if (!rawV3Sql) {
      console.log(
        "\n(no v3 SQL captured by compare; likely SQL logging shape changed in linked ORM build)",
      );
      console.log("Skipping v3 EXPLAIN.");
      return;
    }
    const v3Binds = inferV3Binds(rawV3Sql, binds.context ?? {});
    const v3Sql = inlineBind(rawV3Sql, v3Binds);
    console.log(`\n--- v3 SQL 1 (raw) ---\n${rawV3Sql}`);
    console.log(`\n--- v3 SQL 1 (inlined) ---\n${v3Sql}`);
    await explainSql(pool, "v3 SQL 1", v3Sql);
    await executeSqlOnce(pool, "v3 SQL 1 plain execution", v3Sql);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
