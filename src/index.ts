import express from 'express';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { loadFiles } from '@graphql-tools/load-files';
import { makeExecutableSchema } from '@graphql-tools/schema';
import path from 'path';
import { initializeBloomFilter, initializeBloomFilterClients } from './utils/bloom';
import logger from './logger'

const prisma = new PrismaClient();
const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT || '6379'),
  username: process.env.REDIS_USER,
  password: process.env.REDIS_PASSWORD,
});

async function startServer() {
  logger.info('[Server]: Starting server...');
  await initializeBloomFilterClients(redis, prisma);
  await initializeBloomFilter();

  const typeDefs = await loadFiles(path.join(__dirname, './typeDefs/*.graphql'));
  const resolvers = await loadFiles(path.join(__dirname, './resolvers/*.ts'));

  const schema = makeExecutableSchema({ typeDefs, resolvers });

  const server = new ApolloServer({ schema });

  await server.start();

  const app = express();
  app.use(express.json());

  app.use('/graphql', expressMiddleware(server, {
    context: async () => ({ prisma, redis }),
  }));

  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    logger.info(`[Server]: Server is running on http://localhost:${PORT}/graphql`);
  });
}

startServer().catch((error) => {
  logger.error('[Server Error]: Error starting server:', error);
});