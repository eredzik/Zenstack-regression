import type { PrismaClient } from "@prisma/client";

/**
 * Repository holding the client. Extractor matches `db.model.method` only when the
 * root is an identifier named `db` or `prisma` — not `this.db`. Use a local:
 * `const db = this.db` before queries so extraction picks them up.
 */
export class PostRepository {
  constructor(private readonly db: PrismaClient) {}

  async listRecentForSeedUser() {
    const db = this.db;
    return db.post.findMany({
      where: { authorId: "u1" },
      orderBy: [{ sequence: "asc" }, { id: "asc" }],
      take: 8,
      include: {
        comments: {
          take: 3,
          orderBy: { id: "asc" },
          select: { id: true, content: true },
        },
      },
    });
  }

  async aggregateForSeedUser() {
    const db = this.db;
    return db.post.aggregate({
      where: { authorId: "u1" },
      _count: { id: true },
      _sum: { sequence: true },
      _avg: { sequence: true },
    });
  }

  async findPostP10WithComments() {
    const db = this.db;
    return db.post.findUnique({
      where: { id: "p10" },
      include: {
        comments: {
          orderBy: { content: "asc" },
          take: 5,
        },
      },
    });
  }
}
