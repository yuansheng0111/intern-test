import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";

export interface Context {
  prisma: PrismaClient;
  redis: Redis;
}

export interface ShortenedURL {
  originalUrl: string;
  shortCode: string;
  id: number;
  createdAt: Date;
  updatedAt: Date;
  expiredAt: Date | null;
}
