import { URL } from "url";
import { nanoid } from "nanoid";
import { GraphQLError } from "graphql";
import { PrismaClient } from '@prisma/client';
import { Context, ShortenedURL } from "../typeDefs/types";

const generateShortCode = (): string => {
  return nanoid(10);
};

const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch (error) {
    return false;
  }
};

const checkExistingAndNotExpired = async (
  prisma: PrismaClient,
  shortCode: string
): Promise<ShortenedURL> => {
  const existingUrl = await prisma.shortenedURL.findUnique({ where: { shortCode } });

  if (!existingUrl) {
    throw new GraphQLError(`URL with short code "${shortCode}" not found.`, {
      extensions: { code: 'NOT_FOUND' },
    });
  }

  if (existingUrl.expiredAt && new Date(existingUrl.expiredAt) <= new Date()) {
    throw new GraphQLError('URL has expired and cannot be accessed.', {
      extensions: { code: 'EXPIRED' },
    });
  }

  return existingUrl;
};

export default {
  Query: {
    getUrl: async (
      _: any,
      { shortCode }: { shortCode: string },
      { prisma, redis }: Context
    ): Promise<ShortenedURL | null> => {

      try {
        // Try to get the URL from Redis cache
        const cachedUrl = await redis.get(shortCode);
        if (cachedUrl) {
          const cachedData = JSON.parse(cachedUrl) as ShortenedURL;
          if (cachedData.expiredAt && new Date(cachedData.expiredAt) <= new Date()) {
            await redis.del(shortCode);
            return null;
          }
          return cachedData;
        }

        // If not in cache, fetch from database
        const existingUrl = await checkExistingAndNotExpired(prisma, shortCode);

        // Cache the result in Redis
        const expiryInSeconds = existingUrl.expiredAt
          ? Math.max(0, Math.floor((new Date(existingUrl.expiredAt).getTime() - Date.now()) / 1000))
          : 3600; // Default 1 hour
        await redis.set(shortCode, JSON.stringify(existingUrl), "EX", expiryInSeconds);
        return existingUrl;
        
      } catch (error) {
        console.error("Error in getUrl resolver:", error);
        if (error instanceof GraphQLError && error.extensions.code === 'NOT_FOUND') {
          throw error; // Re-throw NOT_FOUND error
        }
        throw new GraphQLError("Failed to retrieve URL", {
          extensions: { code: "INTERNAL_SERVER_ERROR" },
        });
      }
    },
  },
  Mutation: {
    createUrl: async (
      _: any,
      { originalUrl, shortCode, ttl }: { originalUrl: string; shortCode?: string; ttl?: number },
      { prisma, redis }: Context
    ): Promise<ShortenedURL> => {
      if (!isValidUrl(originalUrl)) {
        throw new GraphQLError('Invalid URL format.', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      if (shortCode && !/^[a-zA-Z0-9_-]+$/.test(shortCode)) {
        throw new GraphQLError('Invalid short code format. Only alphanumeric characters, underscores, and hyphens are allowed.', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      if (ttl !== undefined && (!Number.isInteger(ttl) || ttl <= 0)) {
        throw new GraphQLError('TTL must be a positive integer.', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      try {
        const finalShortCode = shortCode || generateShortCode();
        const expiredAt = ttl ? new Date(Date.now() + ttl * 1000) : null;

        const newUrl = await prisma.shortenedURL.create({
          data: {
            originalUrl,
            shortCode: finalShortCode,
            expiredAt,
          },
        });

        const expiryInSeconds = ttl || 3600;
        await redis.set(finalShortCode, JSON.stringify(newUrl), 'EX', expiryInSeconds);

        return newUrl;
      } catch (error) {
        console.error('Error in createUrl resolver:', error);
        throw new GraphQLError('Failed to create shortened URL', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        });
      }
    },
    updateUrl: async (
      _: any,
      { shortCode, newUrl: originalUrl }: { shortCode: string; newUrl: string },
      { prisma, redis }: Context
    ): Promise<ShortenedURL | null> => {
      if (!isValidUrl(originalUrl)) {
        throw new GraphQLError('Invalid URL format.', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
      
      try {
        const existingUrl = await checkExistingAndNotExpired(prisma, shortCode);

        const updatedUrl = await prisma.shortenedURL.update({
          where: { shortCode },
          data: { originalUrl },
        });

        // Update the cache
        await redis.set(shortCode, JSON.stringify(updatedUrl));

        return updatedUrl;
      } catch (error) {
        console.error("Error in updateUrl resolver:", error);
        if (error instanceof GraphQLError) {
          throw error; // Re-throw GraphQL errors
        }
        throw new GraphQLError(`Failed to update URL with short code: ${shortCode}`, {
          extensions: { code: "INTERNAL_SERVER_ERROR" },
        });
      }
    },
    deleteUrl: async (
      _: any,
      { shortCode }: { shortCode: string },
      { prisma, redis }: Context
    ): Promise<boolean> => {
      try {
        const existingUrl = await checkExistingAndNotExpired(prisma, shortCode);

        await prisma.shortenedURL.delete({
          where: { shortCode },
        });

        // Remove from cache
        await redis.del(shortCode);

        return true;
      } catch (error) {
        console.error("Error in deleteUrl resolver:", error);
        if (error instanceof GraphQLError) {
          throw error; // Re-throw GraphQL errors
        }
        return false;
      }
    },
  },
};
