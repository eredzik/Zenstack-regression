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

/**
 * Tier 6: wider than tier4 — more parent rows × more child comments (often regresses v3 vs Prisma).
 */
export async function benchTier6WidePosts80Comments20(db: PrismaClient) {
  return db.post.findMany({
    where: { authorId: "u1" },
    take: 80,
    orderBy: [{ sequence: "desc" }],
    include: {
      author: { select: { id: true, email: true } },
      comments: {
        orderBy: [{ id: "asc" }],
        take: 20,
        include: {
          author: true,
          post: { select: { id: true, title: true, sequence: true } },
        },
      },
    },
  });
}

/** Tier 7: all u1 posts (120) with deep comment includes — maximum width on seeded u1 graph. */
export async function benchTier7AllU1PostsDeepComments(db: PrismaClient) {
  return db.post.findMany({
    where: { authorId: "u1" },
    orderBy: [{ sequence: "desc" }],
    include: {
      author: { select: { id: true, email: true } },
      comments: {
        orderBy: [{ id: "asc" }],
        include: {
          author: true,
          post: { select: { id: true, title: true, sequence: true } },
        },
      },
    },
  });
}

/**
 * Tier 8: large flat comment scan with nested post → author (cross-user; stresses relation assembly).
 * Often shows v3 slower than Prisma on WASM PGlite and sometimes on server Postgres.
 */
export async function benchTier8WideGlobalCommentsNested(db: PrismaClient) {
  return db.comment.findMany({
    take: 200,
    orderBy: [{ id: "asc" }],
    include: {
      author: { select: { id: true, email: true } },
      post: {
        include: {
          author: { select: { id: true, email: true } },
        },
      },
    },
  });
}

/** Tier 9: u2’s 40 posts × all comments each (second-largest author in seed). */
export async function benchTier9U2PostsAllCommentsNested(db: PrismaClient) {
  return db.post.findMany({
    where: { authorId: "u2" },
    orderBy: [{ sequence: "asc" }],
    include: {
      author: true,
      comments: {
        orderBy: [{ id: "asc" }],
        include: {
          author: true,
          post: { select: { id: true, title: true } },
        },
      },
    },
  });
}

/**
 * Tier 10: two parallel wide branches on one user (posts tree + global comments list).
 * Extra JS-side graph merge vs a single findMany.
 */
export async function benchTier10UserParallelWideBranches(db: PrismaClient) {
  return db.user.findUnique({
    where: { id: "u1" },
    include: {
      posts: {
        orderBy: [{ sequence: "desc" }],
        take: 60,
        include: {
          comments: {
            orderBy: [{ id: "asc" }],
            take: 15,
            include: { author: true },
          },
        },
      },
      comments: {
        orderBy: [{ id: "asc" }],
        take: 100,
        include: {
          author: true,
          post: {
            include: { author: { select: { id: true, email: true } } },
          },
        },
      },
    },
  });
}
