import { graphql, GraphQLSchema } from "graphql";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { describe, it, before, after } from "mocha";
import should from "should";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { loadFiles } from "@graphql-tools/load-files";
import path from "path";
import { Context } from "../../src/typeDefs/types";

let schema: GraphQLSchema;
let prisma: PrismaClient;
let redis: Redis;

before(async () => {
  const typeDefs = await loadFiles(
    path.join(__dirname, "../../src/typeDefs/*.graphql")
  );
  const resolvers = await loadFiles(
    path.join(__dirname, "../../src/resolvers/*.ts")
  );
  schema = makeExecutableSchema({
    typeDefs,
    resolvers,
  });

  prisma = new PrismaClient();
  await prisma.$connect();

  redis = new Redis({
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || "6379"),
    username: process.env.REDIS_USER,
    password: process.env.REDIS_PASSWORD,
  });
});

after(async () => {
  await prisma.$disconnect();
  await redis.quit();
});

describe("URL Shortener Resolvers", () => {
  let context: Context;

  beforeEach(async () => {
    await prisma.shortenedURL.deleteMany();
    await redis.flushall();

    context = { prisma, redis };
  });

  it("should create a new shortened URL", async () => {
    const query = `
      mutation {
        createUrl(originalUrl: "https://example.com") {
          originalUrl
          shortCode
        }
      }
    `;

    const result: any = await graphql({
      schema,
      source: query,
      contextValue: context,
    });

    should.not.exist(result.errors);
    should.exist(result.data);
    should.equal(result.data.createUrl.originalUrl, "https://example.com");

    const savedUrl = await prisma.shortenedURL.findUnique({
      where: { shortCode: result.data.createUrl.shortCode },
    });
    should.exist(savedUrl);
    should.equal(savedUrl?.originalUrl, "https://example.com");
    should.equal(savedUrl?.shortCode, result.data.createUrl.shortCode);

    const cachedUrl = await redis.get(result.data.createUrl.shortCode);
    should.equal(cachedUrl, "https://example.com");
  });

  it.skip("should get an existing URL", async () => {
    // TODO
  });

  it.skip("should update an existing URL", async () => {
    // TODO
  });

  it.skip("should delete an existing URL", async () => {
    // TODO
  });
});
