import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Next.js uses .env.local; explicitly load it for the Prisma CLI without replacing
// values supplied by CI or a deployment environment.
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Migrations use Supabase's direct/session connection, runtime uses its pooler.
    // Generation does not connect, so a non-secret placeholder permits offline builds.
    url: (process.env.VERCEL_ENV === 'production' ? process.env.DATABASE_URL : undefined)
      || process.env.DIRECT_URL || process.env.DATABASE_URL || 'postgresql://localhost:5432/build_only',
  },
});
