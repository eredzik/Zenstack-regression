import type { PrismaClient } from "@prisma/client";

/**
 * Parameterized-style API: client + arguments. For `zenstack-query-compare extract`,
 * query objects must use literals (or the generated harness will not compile).
 * Production code would pass `authorId`, `limit`, etc.; here we pin literals that
 * match the seeded dataset (u1, p1, …).
 */

/** Params mirror a real API; literals in the query keep generated runners self-contained. */
export async function listPostsForAuthor(
  db: PrismaClient,
  _authorId: string,
  _take: number
) {
  return db.post.findMany({
    where: { authorId: "u1" },
    orderBy: { sequence: "desc" },
    take: 5,
    select: { id: true, title: true, sequence: true },
  });
}

export async function countPostsForAuthor(
  db: PrismaClient,
  _authorId: string
) {
  return db.post.count({
    where: { authorId: "u1" },
  });
}

export async function getFirstCommentWithPost(db: PrismaClient) {
  return db.comment.findFirst({
    where: { id: "c1" },
    include: {
      post: { select: { id: true, title: true, sequence: true } },
      author: { select: { id: true, email: true } },
    },
  });
}

export async function groupPostsByAuthorEmail(db: PrismaClient) {
  return db.post.groupBy({
    by: ["authorId"],
    where: { authorId: "u1" },
    _count: { id: true },
    _max: { sequence: true },
  });
}
