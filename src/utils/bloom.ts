import { BloomFilter } from 'bloom-filters';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';

const REDIS_BLOOM_FILTER_KEY = 'url_shortener_bloom_filter';
const BLOOM_FILTER_SIZE = 10000;
const BLOOM_FILTER_ERROR_RATE = 0.01;

let bloomFilter: BloomFilter | null = null;
let redisClient: Redis | null = null;
let prismaClient: PrismaClient | null = null;

// Initialize Redis client and Prisma client
export const initializeBloomFilterClients = (redis: Redis, prisma: PrismaClient): void => {
  redisClient = redis;
  prismaClient = prisma;
};

async function loadBloomFilterFromRedis(): Promise<BloomFilter | null> {
  if (!redisClient) {
    console.warn('Redis client not initialized. Cannot load Bloom Filter.');
    return null;
  }
  try {
    const savedFilter = await redisClient.get(REDIS_BLOOM_FILTER_KEY);
    if (savedFilter) {
      const parsedFilter = JSON.parse(savedFilter);
      return BloomFilter.fromJSON(parsedFilter);
    }
    return null;
  } catch (error) {
    console.error('Error loading Bloom Filter from Redis:', error);
    return null;
  }
}

async function saveBloomFilterToRedis(filter: BloomFilter): Promise<void> {
  if (!redisClient) {
    console.warn('Redis client not initialized. Cannot save Bloom Filter.');
    return;
  }
  try {
    await redisClient.set(REDIS_BLOOM_FILTER_KEY, JSON.stringify(filter.saveAsJSON()));
    // console.log('Bloom Filter persisted to Redis.');
  } catch (error) {
    console.error('Error saving Bloom Filter to Redis:', error);
  }
}

function calculateNbHashes(size: number, expectedItems: number, errorRate: number): number {
  return Math.ceil(-(size / expectedItems) * Math.log(errorRate));
}

async function initializeBloomFilter(): Promise<void> {
  if (!prismaClient) {
    console.warn('Prisma client not initialized. Cannot initialize Bloom Filter from database.');
    return;
  }

  let loadedFilter = await loadBloomFilterFromRedis();

  if (loadedFilter) {
    bloomFilter = loadedFilter;
    console.log('Bloom Filter loaded from Redis.');
  } else {
    const expectedItems = BLOOM_FILTER_SIZE / 2; // estimated items
    const nbHashes = calculateNbHashes(BLOOM_FILTER_SIZE, expectedItems, BLOOM_FILTER_ERROR_RATE);

    bloomFilter = new BloomFilter(BLOOM_FILTER_SIZE, nbHashes);

    try {
      const existingUrls = await prismaClient.shortenedURL.findMany({ select: { shortCode: true } });
      existingUrls.forEach((url) => bloomFilter!.add(url.shortCode));
      await saveBloomFilterToRedis(bloomFilter);
      console.log('New Bloom Filter created and initialized with existing short codes.');
    } catch (error) {
      console.error('Error initializing Bloom Filter from database:', error);
      bloomFilter = null;
    }
  }
}

export const isShortCodeInBloomFilter = (shortCode: string): boolean => {
  return bloomFilter ? bloomFilter.has(shortCode) : false;
};

export const addShortCodeToBloomFilter = async (shortCode: string): Promise<void> => {
  if (bloomFilter && !bloomFilter.has(shortCode)) {
    bloomFilter.add(shortCode);
    await saveBloomFilterToRedis(bloomFilter);
  }
};

export { initializeBloomFilter };
