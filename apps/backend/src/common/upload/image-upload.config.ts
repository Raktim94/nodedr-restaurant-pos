import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Request } from 'express';
import { diskStorage, type FileFilterCallback } from 'multer';

// Persisted separately from the app's own image (a bind/named volume in
// docker-compose.yml) so uploaded menu photos survive container rebuilds,
// the same way the Postgres volume survives them — see README/ARCHITECTURE.
export function uploadsDir(): string {
  const dir = process.env.UPLOADS_DIR ?? join(process.cwd(), 'uploads');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export const imageUploadOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir()),
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase();
      cb(null, `${randomUUID()}${ALLOWED_EXTENSIONS.has(ext) ? ext : '.jpg'}`);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (
    _req: Request,
    file: Express.Multer.File,
    cb: FileFilterCallback,
  ) => {
    const ext = extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext) || !file.mimetype.startsWith('image/')) {
      cb(
        new BadRequestException(
          'Only image files (jpg, png, webp, gif) are allowed',
        ),
      );
      return;
    }
    cb(null, true);
  },
};
