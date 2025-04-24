import { URL } from 'url';
import { nanoid } from 'nanoid';
import { GraphQLError } from 'graphql';
import { PrismaClient } from '@prisma/client';
import { Context, ShortenedURL } from '../typeDefs/types';
import { addShortCodeToBloomFilter, isShortCodeInBloomFilter } from '../utils/bloom';
import logger from '../logger';

const generateShortCode = (): string => {
  return nanoid(10);
};

const isValidUrl = (urlString: string): boolean => {
  try {
    // Attempt to create a URL object from the string
    new URL(urlString);
    return true;
  } catch {
    return false;
  }
};

const checkExistingAndNotExpired = async (prisma: PrismaClient, shortCode: string): Promise<ShortenedURL> => {
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
      { prisma, redis }: Context,
    ): Promise<ShortenedURL | null> => {
      logger.info('[API Request]: Received getUrl request', { shortCode });

      if (!isShortCodeInBloomFilter(shortCode)) {
        throw new GraphQLError('URL not found.', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

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
        await redis.set(shortCode, JSON.stringify(existingUrl), 'EX', expiryInSeconds);

        logger.info('[API Response]: getUrl completed', { shortCode });
        return existingUrl;
      } catch (error) {
        logger.error('[API Error]: Error getting URL', { error, shortCode });
        if (error instanceof GraphQLError && error.extensions.code === 'NOT_FOUND') {
          throw error; // Re-throw NOT_FOUND error
        }
        throw new GraphQLError('Failed to retrieve URL', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        });
      }
    },
  },
  Mutation: {
    createUrl: async (
      _: any,
      { originalUrl, shortCode, ttl }: { originalUrl: string; shortCode?: string; ttl?: number },
      { prisma, redis }: Context,
    ): Promise<ShortenedURL> => {
      logger.info('[API Request]: Received createUrl request', { originalUrl, shortCode, ttl });
      if (!isValidUrl(originalUrl)) {
        throw new GraphQLError('Invalid URL format.', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      if (shortCode && !/^[a-zA-Z0-9_-]+$/.test(shortCode)) {
        throw new GraphQLError(
          'Invalid short code format. Only alphanumeric characters, underscores, and hyphens are allowed.',
          {
            extensions: { code: 'BAD_USER_INPUT' },
          },
        );
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

        await addShortCodeToBloomFilter(finalShortCode);

        logger.info('[API Response]: createUrl completed', {
          id: newUrl.id,
          shortCode: newUrl.shortCode,
        });

        return newUrl;
      } catch (error) {
        logger.error('[API Error]: Error creating URL', { error, originalUrl, shortCode, ttl });
        throw new GraphQLError('Failed to create shortened URL', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        });
      }
    },
    updateUrl: async (
      _: any,
      { shortCode, newUrl }: { shortCode: string; newUrl: string },
      { prisma, redis }: Context,
    ): Promise<ShortenedURL | null> => {
      logger.info('[API Request]: Received updateUrl request', { shortCode, newUrl });
      if (!isValidUrl(newUrl)) {
        throw new GraphQLError('Invalid URL format.', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      try {
        await checkExistingAndNotExpired(prisma, shortCode);

        const updatedUrl = await prisma.shortenedURL.update({
          where: { shortCode },
          data: { originalUrl: newUrl },
        });

        // Update the cache
        await redis.set(shortCode, JSON.stringify(updatedUrl));

        logger.info('[API Response]: updateUrl completed', { shortCode });
        return updatedUrl;
      } catch (error) {
        logger.error('[API Error]: Error updating URL', { error, shortCode, newUrl });
        if (error instanceof GraphQLError) {
          throw error; // Re-throw GraphQL errors
        }
        throw new GraphQLError(`Failed to update URL with short code: ${shortCode}`, {
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        });
      }
    },
    deleteUrl: async (_: any, { shortCode }: { shortCode: string }, { prisma, redis }: Context): Promise<boolean> => {
      logger.info('[API Request]: Received deleteUrl request', { shortCode });

      try {
        await checkExistingAndNotExpired(prisma, shortCode);
        await prisma.shortenedURL.delete({ where: { shortCode } });
        await redis.del(shortCode);

        logger.info('[API Response]: deleteUrl completed', { shortCode });
        return true;
      } catch (error) {
        logger.error('[API Error]: Error deleting URL', { error, shortCode });
        if (error instanceof GraphQLError) {
          throw error; // Re-throw GraphQL errors
        }
        return false;
      }
    },
  },
};
