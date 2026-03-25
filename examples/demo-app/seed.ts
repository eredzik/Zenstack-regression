import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Match ZenStack test helpers: descending sequence ids (pN) for stable ordering checks. */
const REGRESSION_POST_COUNT = 22;

function makePostsData(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const sequence = count - i;
    return {
      id: `p${sequence}`,
      sequence,
      title: `P${sequence}`,
      authorId: "u1",
    };
  });
}

function makeCommentsData(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const sequence = count - i;
    return {
      id: `c${sequence}`,
      postId: `p${sequence}`,
      content: `C${sequence}`,
      authorId: sequence % 11 === 0 ? null : "u1",
    };
  });
}

async function main() {
  await prisma.comment.deleteMany();
  await prisma.post.deleteMany();
  await prisma.user.deleteMany();

  await prisma.user.create({
    data: {
      id: "u1",
      email: "u1@example.com",
      posts: {
        create: makePostsData(REGRESSION_POST_COUNT).map((p) => ({
          id: p.id,
          sequence: p.sequence,
          title: p.title,
        })),
      },
    },
  });

  await prisma.comment.createMany({
    data: makeCommentsData(REGRESSION_POST_COUNT),
  });

  console.log(
    "Seeded regression dataset: u1 +",
    REGRESSION_POST_COUNT,
    "posts +",
    REGRESSION_POST_COUNT,
    "comments"
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
