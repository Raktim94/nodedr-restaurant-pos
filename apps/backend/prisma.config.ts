import { resolve } from 'node:path';
import { config } from 'dotenv';
import { expand } from 'dotenv-expand';
import { defineConfig } from 'prisma/config';

// Prisma 6 stops loading .env automatically when a config file is present.
expand(config({ path: [resolve(__dirname, '.env'), resolve(__dirname, 'prisma/.env')] }));

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'ts-node prisma/seed.ts' },
});
