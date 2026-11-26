import { PayloadTooLargeException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, type NextFunction, type Request, type Response } from 'express';

export function configureJsonBodyParsers(app: NestExpressApplication) {
  // The AI assistant accepts base64 receipt and invoice images. Parse those
  // requests before the smaller default parser, which also retains webhook bytes.
  app.use('/api/v1/ai', json({ limit: process.env.AI_BODY_LIMIT ?? '12mb' }));
  app.useBodyParser('json', { limit: process.env.BODY_LIMIT ?? '100kb' });

  app.use((err: unknown, _req: Request, _res: Response, next: NextFunction) => {
    // Express identifies size rejections by type. Pass other errors through to Nest.
    if (
      err instanceof Error &&
      'type' in err &&
      err.type === 'entity.too.large'
    ) {
      return next(new PayloadTooLargeException(err.message));
    }
    next(err);
  });
}
