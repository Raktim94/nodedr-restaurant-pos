import { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { uploadsDir } from './common/upload/image-upload.config';

// Known example/placeholder secrets that appear verbatim in this repo's own
// .env.example, docker-compose.yml, and the CasaOS/ZimaOS app-store
// manifest (casaos/docker-compose.yml) — that manifest hardcodes a literal
// default value (CasaOS app-store installers pre-fill it and many
// non-technical self-hosters click through without changing it) rather
// than failing loudly the way `${JWT_SECRET:?...}` does in the main
// docker-compose.yml. This is a defense-in-depth backstop that applies to
// every deployment path, not just CasaOS: refuse to issue/verify sessions
// signed with a known-public or too-short secret instead of silently
// running with one an attacker can read directly from the public repo.
const KNOWN_PLACEHOLDER_JWT_SECRETS = new Set([
  'please-change-this-to-a-long-random-string',
  'change-me-to-a-long-random-string',
  'change-me',
  'changeme',
  'secret',
  'your-secret-here',
]);
const MIN_JWT_SECRET_LENGTH = 32;

function assertSecureJwtSecret(): void {
  const secret = process.env.JWT_SECRET ?? '';
  if (
    KNOWN_PLACEHOLDER_JWT_SECRETS.has(secret.trim().toLowerCase()) ||
    secret.length < MIN_JWT_SECRET_LENGTH
  ) {
    console.error(
      `Refusing to start: JWT_SECRET is missing, a known placeholder value, or shorter than ${MIN_JWT_SECRET_LENGTH} characters. ` +
        'Set a real, unique, random JWT_SECRET (e.g. `openssl rand -hex 32`) before starting the backend — ' +
        'this protects every session this server will ever issue.',
    );
    process.exit(1);
  }
}

async function bootstrap() {
  assertSecureJwtSecret();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.use(
    helmet({
      // Uploaded images are fetched cross-origin-ish (via the frontend's
      // same-origin /api proxy, but still through an <img> tag) — the
      // default helmet CORP header blocks that in some browsers.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:1995',
    credentials: true,
  });
  app.setGlobalPrefix('api');
  app.useStaticAssets(uploadsDir(), { prefix: '/api/uploads/' });

  // Full route/schema map — genuinely useful in dev, but an unauthenticated
  // information-disclosure surface (every endpoint shape, DTO field, and
  // permission key) if left reachable in production. Opt in explicitly via
  // ENABLE_SWAGGER=true if a deployment wants it anyway (e.g. behind its
  // own reverse-proxy auth).
  if (
    process.env.NODE_ENV !== 'production' ||
    process.env.ENABLE_SWAGGER === 'true'
  ) {
    const config = new DocumentBuilder()
      .setTitle('Nodedr OrderRestro API')
      .setDescription('REST API for the Nodedr OrderRestro management system')
      .setVersion('1.0')
      .addCookieAuth('nodedr_session')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  console.log(
    `Nodedr OrderRestro API listening on :${port} (docs at /api/docs)`,
  );
}
void bootstrap();
