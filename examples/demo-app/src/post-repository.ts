import type { PrismaClient } from "@prisma/client";

/** Repository holding the client — `this.db.post.findMany` is extracted. */
export class PostRepository {
  constructor(private readonly db: PrismaClient) {}

  async listRecentForSeedUser() {
    return this.db.post.findMany({
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
    return this.db.post.aggregate({
      where: { authorId: "u1" },
      _count: { id: true },
      _sum: { sequence: true },
      _avg: { sequence: true },
    });
  }

  async findPostP10WithComments() {
    return this.db.post.findUnique({
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
