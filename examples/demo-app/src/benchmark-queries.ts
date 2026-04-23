import type { PrismaClient } from "@prisma/client";

/**
 * Queries for ZenStack v2 vs v3 performance benchmarks on PostgreSQL.
 * `zenstack-query-compare extract` picks up `db.*` calls here; run `npm run extract`
 * then `npm run build-queries` before `npm run benchmark`.
 *
 * Tiers (rough complexity): simple scalar → one row + shallow includes →
 * deep nested includes on one user → many parent rows each with nested includes.
 */

/** Tier 1: single row, scalar select (minimal ORM / SQL surface). */
export async function benchTier1ScalarUser(db: PrismaClient) {
  return db.user.findUnique({
    where: { id: "u1" },
    select: { id: true, email: true },
  });
}

/** Tier 2: one comment row with two relation includes (no nesting under includes). */
export async function benchTier2CommentWithPostAndAuthor(db: PrismaClient) {
  return db.comment.findFirst({
    where: { id: "c1" },
    include: {
      post: { select: { id: true, title: true, sequence: true } },
      author: { select: { id: true, email: true } },
    },
  });
}

/** Tier 3: one user, nested posts → comments → author + parallel user.comments → post. */
export async function benchTier3DeepNestedUser(db: PrismaClient) {
  return db.user.findUnique({
    where: { id: "u1" },
    include: {
      posts: {
        orderBy: [{ sequence: "desc" }, { id: "asc" }],
        include: {
          comments: {
            orderBy: [{ id: "asc" }],
            include: {
              author: true,
            },
          },
        },
      },
      comments: {
        orderBy: [{ content: "desc" }],
        include: {
          post: {
            select: { id: true, sequence: true, title: true },
          },
        },
      },
    },
  });
}

/** Tier 4: larger slice of posts each with nested comments (and authors); stresses fan-out. */
export async function benchTier4WidePostsNested(db: PrismaClient) {
  return db.post.findMany({
    where: { authorId: "u1" },
    take: 40,
    orderBy: [{ sequence: "desc" }],
    include: {
      author: { select: { id: true, email: true } },
      comments: {
        orderBy: [{ id: "asc" }],
        take: 12,
        include: {
          author: true,
          post: { select: { id: true, title: true } },
        },
      },
    },
  });
}

/** Tier 5: very heavy nested tree on u1 (large take on posts + comments). */
export async function benchTier5VeryHeavyUserTree(db: PrismaClient) {
  return db.user.findUnique({
    where: { id: "u1" },
    include: {
      posts: {
        orderBy: [{ sequence: "desc" }],
        take: 100,
        include: {
          comments: {
            orderBy: [{ id: "asc" }],
            include: { author: true },
          },
        },
      },
      comments: {
        orderBy: [{ content: "desc" }],
        take: 80,
        include: {
          post: { select: { id: true, sequence: true, title: true } },
        },
      },
    },
  });
}
