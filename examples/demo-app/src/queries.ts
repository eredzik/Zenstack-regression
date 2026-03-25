import type { PrismaClient } from "@prisma/client";

/**
 * Regression: nested includes + orderBy (nullable nested relation on Comment.author).
 * Known to diverge between ZenStack v2 (Prisma) and v3 ORM for some orderings.
 * Data is seeded in seed.ts (u1, posts p1..pN, comments c1..cN).
 */

/** Mirrors client-api relation / order-by nested includes style queries. */
export async function regressionNestedIncludesOrderBy(db: PrismaClient) {
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

export async function simpleUserById(db: PrismaClient) {
  return db.user.findUnique({
    where: { id: "u1" },
    select: { id: true, email: true },
  });
}
