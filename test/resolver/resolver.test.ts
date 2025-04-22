import { graphql, GraphQLSchema } from "graphql";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { describe, it, before, after, beforeEach } from "mocha";
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

beforeEach(async () => {
  await prisma.shortenedURL.deleteMany();
  await redis.flushall();
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
    // should.equal(cachedUrl, "https://example.com");
    const cachedData = JSON.parse(cachedUrl as string);
    should.equal(cachedData.originalUrl, "https://example.com");
  });

  it("should get an existing URL", async () => {
    const originalUrl = "https://existing.com";
    const shortCode = "existingCode";
    await prisma.shortenedURL.create({ data: { originalUrl, shortCode } });
    await redis.set(shortCode, JSON.stringify({ originalUrl, shortCode })); // 模拟已存在的缓存

    const query = `
      query {
        getUrl(shortCode: "${shortCode}") {
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
    should.equal(result.data.getUrl.originalUrl, originalUrl);
    should.equal(result.data.getUrl.shortCode, shortCode);
  });

  it("should update an existing URL", async () => {
    const originalUrl = "https://old.com";
    const shortCode = "updateCode";
    const newOriginalUrl = "https://new.com";
    await prisma.shortenedURL.create({ data: { originalUrl, shortCode } });
    await redis.set(shortCode, JSON.stringify({ originalUrl, shortCode })); // 模拟已存在的缓存

    const query = `
      mutation {
        updateUrl(shortCode: "${shortCode}", newUrl: "${newOriginalUrl}") {
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
    should.equal(result.data.updateUrl.originalUrl, newOriginalUrl);
    should.equal(result.data.updateUrl.shortCode, shortCode);

    const updatedUrl = await prisma.shortenedURL.findUnique({ where: { shortCode } });
    should.exist(updatedUrl);
    should.equal(updatedUrl?.originalUrl, newOriginalUrl);

    const cachedUrl = await redis.get(shortCode);
    should.equal(cachedUrl, JSON.stringify(updatedUrl));
  });

  it("should delete an existing URL", async () => {
    const originalUrl = "https://delete.com";
    const shortCode = "deleteCode";
    await prisma.shortenedURL.create({ data: { originalUrl, shortCode } });
    await redis.set(shortCode, JSON.stringify({ originalUrl, shortCode }));

    const query = `
      mutation {
        deleteUrl(shortCode: "${shortCode}")
      }
    `;

    const result: any = await graphql({
      schema,
      source: query,
      contextValue: context,
    });

    should.not.exist(result.errors);
    should.exist(result.data);
    should.equal(result.data.deleteUrl, true);

    const deletedUrl = await prisma.shortenedURL.findUnique({ where: { shortCode } });
    should.not.exist(deletedUrl);

    const cachedUrl = await redis.get(shortCode);
    should.not.exist(cachedUrl);
  });

  it("should return null for a non-existing URL", async () => {
    const query = `
      query {
        getUrl(shortCode: "nonExistingCode") {
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

    should.exist(result.errors);
    should.not.exist(result.data.getUrl);
    should.equal(result.errors[0].extensions.code, 'NOT_FOUND');
  });

  it("should return an error for updateUrl if shortCode does not exist", async () => {
    const query = `
      mutation {
        updateUrl(shortCode: "nonExistentCode", newUrl: "https://new.com") {
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

    should.exist(result.errors);
    should.equal(result.errors[0].message, 'URL with short code "nonExistentCode" not found.');
    should.equal(result.errors[0].extensions.code, 'NOT_FOUND');
  });

  it("should return an error for deleteUrl if shortCode does not exist", async () => {
    const query = `
      mutation {
        deleteUrl(shortCode: "nonExistentCode")
      }
    `;

    const result: any = await graphql({
      schema,
      source: query,
      contextValue: context,
    });

    should.exist(result.errors);
    should.equal(result.errors[0].message, 'URL with short code "nonExistentCode" not found.');
    should.equal(result.errors[0].extensions.code, 'NOT_FOUND');
  });
});
