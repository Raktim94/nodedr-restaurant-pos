import { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { uploadsDir } from './common/upload/image-upload.config';

async function bootstrap() {
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

  const config = new DocumentBuilder()
    .setTitle('Nodedr Restaurant API')
    .setDescription('REST API for the Nodedr Restaurant management system')
    .setVersion('1.0')
    .addCookieAuth('nodedr_session')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  console.log(
    `Nodedr Restaurant API listening on :${port} (docs at /api/docs)`,
  );
}
void bootstrap();
