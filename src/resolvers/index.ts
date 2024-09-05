import { nanoid } from "nanoid";
import { GraphQLError } from "graphql";
import { Context, ShortenedURL } from "../typeDefs/types";

export default {
  Query: {
    getUrl: async (
      _: any,
      { shortCode }: { shortCode: string },
      { prisma, redis }: Context
    ): Promise<ShortenedURL | null> => {
      // TODO: handle custom shortCode and ttl

      try {
        // Try to get the URL from Redis cache
        const cachedUrl = await redis.get(shortCode);
        if (cachedUrl) {
          return {
            originalUrl: cachedUrl,
            shortCode,
          };
        }

        // If not in cache, fetch from database
        const url = await prisma.shortenedURL.findUnique({
          where: { shortCode },
        });

        if (url) {
          // Cache the result in Redis
          await redis.set(shortCode, url.originalUrl, "EX", 3600);
          return url;
        }

        throw new GraphQLError("URL not found", {
          extensions: { code: "NOT_FOUND" },
        });
      } catch (error) {
        console.error("Error in getUrl resolver:", error);
        throw new GraphQLError("Failed to retrieve URL", {
          extensions: { code: "INTERNAL_SERVER_ERROR" },
        });
      }
    },
  },
  Mutation: {
    createUrl: async (
      _: any,
      { originalUrl }: { originalUrl: string },
      { prisma, redis }: Context
    ): Promise<ShortenedURL> => {
      try {
        let shortCode: string;

        shortCode = nanoid(7);

        const newUrl = await prisma.shortenedURL.create({
          data: {
            originalUrl,
            shortCode,
          },
        });

        // Cache the new URL
        await redis.set(shortCode, originalUrl, "EX", 3600);

        return newUrl;
      } catch (error) {
        console.error("Error in createUrl resolver:", error);
        throw new GraphQLError("Failed to create shortened URL", {
          extensions: { code: "INTERNAL_SERVER_ERROR" },
        });
      }
    },
    // TODO
    // updateUrl: async (
    //   _: any,
    //   { shortCode, newUrl }: { shortCode: string; newUrl: string },
    //   { prisma, redis }: Context
    // ): Promise<ShortenedURL> => {
    // },
    // deleteUrl: async (
    //   _: any,
    //   { shortCode }: { shortCode: string },
    //   { prisma, redis }: Context
    // ): Promise<boolean> => {
    // },
  },
};
