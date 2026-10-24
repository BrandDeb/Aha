import { MAX_PROJECT_SIZE } from './compiler.ts';
import { createRateLimiter } from './rate-limit.ts';

/** Builds and coverage runs are CPU-heavy: one budget per client for both (the build queue caps them overall) */
export const compileLimiter = createRateLimiter(Number(process.env.COMPILE_REQUESTS_PER_10_MIN) || 300, 10 * 60 * 1000);

/** JSON escaping can double the size of the sources; allow for it */
export const MAX_COMPILE_BODY = MAX_PROJECT_SIZE * 2 + 64 * 1024;
