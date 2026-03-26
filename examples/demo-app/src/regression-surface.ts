import type { PrismaClient } from "@prisma/client";

/**
 * Extra shapes that often diverge between Prisma/ZenStack v2 and v3 ORM:
 * nested includes/orderBy, complex AND/OR/NOT, relation filters, aggregates.
 * Requires seed.ts data (u1 + posts; u2 optional).
 */

/** Nested include + orderBy on user.comments (string sort: C9 vs C100 vs "alpha"). */
export async function nestedUserCommentsOrderByContent(db: PrismaClient) {
  return db.user.findUnique({
    where: { id: "u1" },
    include: {
      comments: {
        orderBy: { content: "desc" },
        take: 60,
        include: { post: { select: { id: true, title: true } } },
      },
    },
  });
}

/** Scalar OR on Post — simple boolean form (u1 scale: high sequences + p1). */
export async function postsWhereOrSequence(db: PrismaClient) {
  return db.post.findMany({
    where: {
      OR: [{ sequence: { gte: 100 } }, { id: "p1" }],
    },
    orderBy: { sequence: "asc" },
    select: { id: true, sequence: true, title: true },
  });
}

/** AND of two OR groups (posts) — straddles lexicographic title edge cases. */
export async function postsWhereAndOfOr(db: PrismaClient) {
  return db.post.findMany({
    where: {
      AND: [
        { OR: [{ sequence: { lte: 3 } }, { sequence: { gte: 115 } }] },
        {
          OR: [
            { title: { startsWith: "T-u1-" } },
            { id: "p22" },
            { id: "p100" },
          ],
        },
      ],
    },
    orderBy: { sequence: "asc" },
    take: 25,
    select: { id: true, sequence: true },
  });
}

/** NOT + relation: users with no post below sequence 5. */
export async function usersWherePostsNoneLowSequence(db: PrismaClient) {
  return db.user.findMany({
    where: {
      posts: {
        none: { sequence: { lt: 5 } },
      },
    },
    select: { id: true, email: true },
  });
}

/** Comment: OR on nullable scalar + content filter (large overlap on `C2*`). */
export async function commentsWhereOrNullOrPrefix(db: PrismaClient) {
  return db.comment.findMany({
    where: {
      OR: [{ authorId: null }, { content: { startsWith: "C2" } }],
    },
    orderBy: { id: "asc" },
    take: 80,
    select: { id: true, content: true, authorId: true },
  });
}

/** User: top-level OR mixing relation and scalar. */
export async function usersWhereOrRelationOrEmail(db: PrismaClient) {
  return db.user.findMany({
    where: {
      OR: [
        { posts: { some: { sequence: 1 } } },
        { email: { contains: "u2" } },
      ],
    },
    orderBy: { id: "asc" },
    select: { id: true, email: true },
  });
}

/** Nested relation filter with inner OR (posts of user). */
export async function userFindPostsSomeOrInside(db: PrismaClient) {
  return db.user.findFirst({
    where: {
      id: "u1",
      posts: {
        some: {
          OR: [{ sequence: 11 }, { sequence: 22 }],
        },
      },
    },
    include: {
      posts: {
        where: {
          OR: [{ sequence: 11 }, { sequence: 22 }],
        },
        orderBy: { sequence: "asc" },
      },
    },
  });
}

/** Post aggregate with OR filter (overlap with nested issue class). */
export async function postsAggregateWithOr(db: PrismaClient) {
  return db.post.aggregate({
    where: {
      OR: [{ published: false }, { sequence: { gt: 15 } }],
    },
    _count: { id: true },
    _max: { sequence: true },
    _min: { sequence: true },
  });
}

/** Group by published with HAVING-style filter via where (uses OR on relation path). */
export async function postsGroupByWithAuthorOr(db: PrismaClient) {
  return db.post.groupBy({
    by: ["authorId"],
    where: {
      OR: [{ sequence: { lte: 2 } }, { sequence: { gte: 21 } }],
    },
    _count: { id: true },
    orderBy: { authorId: "asc" },
  });
}
