#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error(
    "DATABASE_URL is required, e.g. postgresql://demo:demo@127.0.0.1:5434/zenstack_compare_demo"
  );
  process.exit(1);
}

const AUTHOR_ID = process.env.AUTHOR_ID ?? "u1";
const POSTS_TAKE = Number(process.env.POSTS_TAKE ?? "80");
const COMMENTS_TAKE = Number(process.env.COMMENTS_TAKE ?? "20");
const RUNS = Number(process.env.RUNS ?? "10");

function lit(v) {
  if (typeof v === "number") return String(v);
  return `'${String(v).replaceAll("'", "''")}'`;
}

function inlineBind(sql, values) {
  return sql.replace(/\$(\d+)/g, (_m, n) => {
    const i = Number(n) - 1;
    if (i < 0 || i >= values.length) throw new Error(`Missing value for $${n}`);
    return lit(values[i]);
  });
}

function p(v) {
  if (!v.length) return "n/a";
  const s = [...v].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return (s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2).toFixed(3);
}

function getCurrentV3Sql() {
  const cmd = [
    "node",
    "../../dist/cli.js",
    "compare",
    "--cwd",
    ".",
    "--queries-dir",
    "./.zenstack-compare/queries",
    "--enhance-v2",
    "./.zenstack-compare/enhance-v2.mjs",
    "--enhance-v3",
    "./enhance-v3.mjs",
    "--query-name",
    "benchTier6WidePosts80Comments20",
    "--ignore-sql-diff",
    "--json",
  ];
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`Failed to fetch current v3 SQL:\n${r.stderr || r.stdout}`);
  }
  const rows = JSON.parse(r.stdout);
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("compare returned no rows; check --query-name and extraction output");
  }
  if (!rows[0].sqlV3?.[0]) {
    const errV2 = rows[0].errorV2 ?? "n/a";
    const errV3 = rows[0].errorV3 ?? "n/a";
    throw new Error(
      [
        "compare output missing sqlV3[0].",
        "Likely cause: query execution failed before SQL capture.",
        `errorV2: ${errV2}`,
        `errorV3: ${errV3}`,
        "Ensure DB is initialized, then run:",
        "  DATABASE_URL=... npm run db:push",
        "  DATABASE_URL=... npm run db:seed",
      ].join("\n")
    );
  }
  return rows[0].sqlV3[0];
}

const OPTIMIZED_SQL = `
WITH selected_posts AS (
  SELECT
    p.id,
    p.sequence,
    p.title,
    p.published,
    p."authorId",
    p."projectId"
  FROM "public"."Post" p
  WHERE p."authorId" = $1
  ORDER BY p.sequence DESC
  LIMIT $2
),
ranked_comments AS (
  SELECT
    c.id,
    c.content,
    c."postId",
    c."authorId",
    row_number() OVER (
      PARTITION BY c."postId"
      ORDER BY c.id ASC
    ) AS rn
  FROM "public"."Comment" c
  JOIN selected_posts sp ON sp.id = c."postId"
),
selected_comments AS (
  SELECT *
  FROM ranked_comments
  WHERE rn <= $3
),
comments_with_lookups AS (
  SELECT
    sc."postId",
    sc.id,
    sc.content,
    sc."authorId",
    jsonb_build_object(
      'id', cp.id,
      'title', cp.title,
      'sequence', cp.sequence
    ) AS post_json,
    jsonb_build_object(
      'id', cu.id,
      'email', cu.email
    ) AS author_json
  FROM selected_comments sc
  LEFT JOIN "public"."Post" cp ON cp.id = sc."postId"
  LEFT JOIN "public"."User" cu ON cu.id = sc."authorId"
),
comments_agg AS (
  SELECT
    cwl."postId",
    jsonb_agg(
      jsonb_build_object(
        'id', cwl.id,
        'content', cwl.content,
        'postId', cwl."postId",
        'authorId', cwl."authorId",
        'post', cwl.post_json,
        'author', cwl.author_json
      )
      ORDER BY cwl.id ASC
    ) AS comments_json
  FROM comments_with_lookups cwl
  GROUP BY cwl."postId"
)
SELECT
  sp.id,
  sp.sequence,
  sp.title,
  sp.published,
  sp."authorId",
  sp."projectId",
  jsonb_build_object('id', u.id, 'email', u.email) AS author,
  COALESCE(ca.comments_json, '[]'::jsonb) AS comments
FROM selected_posts sp
LEFT JOIN "public"."User" u ON u.id = sp."authorId"
LEFT JOIN comments_agg ca ON ca."postId" = sp.id
ORDER BY sp.sequence DESC
`;

async function explain(pool, label, sql) {
  const rs = await pool.query(
    `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT) ${sql}`
  );
  console.log(`\n=== ${label} EXPLAIN ===`);
  for (const row of rs.rows) {
    if (row["QUERY PLAN"]) console.log(row["QUERY PLAN"]);
  }
}

async function bench(pool, label, sql) {
  const times = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = process.hrtime.bigint();
    await pool.query(sql);
    const t1 = process.hrtime.bigint();
    times.push(Number(t1 - t0) / 1e6);
  }
  const mean = (times.reduce((a, b) => a + b, 0) / times.length).toFixed(3);
  console.log(
    `${label} runtime ms (n=${RUNS}): median=${p(times)} mean=${mean} min=${Math.min(...times).toFixed(3)} max=${Math.max(...times).toFixed(3)}`
  );
}

async function main() {
  const currentV3Raw = getCurrentV3Sql();
  const currentV3Sql = inlineBind(currentV3Raw, [COMMENTS_TAKE, AUTHOR_ID, POSTS_TAKE]);
  const optimizedSql = inlineBind(OPTIMIZED_SQL, [AUTHOR_ID, POSTS_TAKE, COMMENTS_TAKE]);

  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    console.log(
      `Analyzing benchTier6WidePosts80Comments20 with AUTHOR_ID=${AUTHOR_ID}, POSTS_TAKE=${POSTS_TAKE}, COMMENTS_TAKE=${COMMENTS_TAKE}`
    );
    await explain(pool, "Current v3 SQL", currentV3Sql);
    await explain(pool, "Optimized single SQL", optimizedSql);

    console.log("\n=== Runtime Comparison ===");
    await bench(pool, "Current v3 SQL", currentV3Sql);
    await bench(pool, "Optimized single SQL", optimizedSql);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
