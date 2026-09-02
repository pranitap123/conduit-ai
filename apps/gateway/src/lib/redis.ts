import { Redis } from 'ioredis';
import { env } from '../config/env.js';

/**
 * WHY no eager module-level connection: importing a module should never open a
 * socket. An eager singleton means a unit test, a migration script or a CLI
 * command all connect to Redis just by importing something that imports this.
 * Connections are created explicitly, by the code that owns their lifetime.
 */
export function createRedis(): Redis {
  return new Redis(env.redisUrl, {
    // Fail fast rather than queueing commands forever while Redis is down. A
    // gateway that silently buffers rate-limit checks is not rate limiting.
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    lazyConnect: true,
  });
}

/** Await this before issuing commands, since lazyConnect defers the socket. */
export async function connectRedis(client: Redis): Promise<Redis> {
  if (client.status !== 'ready') await client.connect();
  return client;
}

let shared: Redis | null = null;

/** Process-wide client for the running server. Created on first use. */
export async function getRedis(): Promise<Redis> {
  shared ??= createRedis();
  return connectRedis(shared);
}

export async function closeRedis(): Promise<void> {
  if (shared !== null && shared.status === 'ready') await shared.quit();
  shared = null;
}
