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
  authorId: string,
  take: number
) {
  return db.post.findMany({
    where: { authorId: authorId },
    orderBy: { sequence: "desc" },
    take: take,
    select: { id: true, title: true, sequence: true },
  });
}

export async function countPostsForAuthor(
  db: PrismaClient,
  authorId: string
) {
  return db.post.count({
    where: { authorId: authorId },
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

export async function groupPostsByAuthorEmail(db: PrismaClient, authorId: string) {
  return db.post.groupBy({
    by: ["authorId"],
    where: { authorId: authorId },
    _count: { id: true },
    _max: { sequence: true },
  });
}

/** Transaction client `tx` — generated harness wraps in `db.$transaction`. */
export async function countUsersInTransaction(db: PrismaClient): Promise<number> {
  return db.$transaction(async (tx: PrismaClient) => {
    return tx.user.count();
  });
}
