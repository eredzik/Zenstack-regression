import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.tag.deleteMany();
  await prisma.post.deleteMany();
  await prisma.user.deleteMany();

  const alice = await prisma.user.create({
    data: {
      email: "alice@example.com",
      name: "Alice",
      role: "admin",
      posts: {
        create: [
          {
            title: "Hello world",
            body: "First post",
            published: true,
            viewCount: 12,
            tags: {
              connectOrCreate: [
                { where: { name: "news" }, create: { name: "news" } },
                { where: { name: "meta" }, create: { name: "meta" } },
              ],
            },
          },
          {
            title: "Draft ideas",
            body: null,
            published: false,
            viewCount: 0,
          },
        ],
      },
    },
    include: { posts: true },
  });

  const bob = await prisma.user.create({
    data: {
      email: "bob@example.org",
      name: "Bob",
      role: "member",
      posts: {
        create: {
          title: "Member post",
          published: true,
          viewCount: 3,
          tags: {
            connectOrCreate: {
              where: { name: "news" },
              create: { name: "news" },
            },
          },
        },
      },
    },
  });

  console.log("Seeded users:", alice.id, bob.id);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
