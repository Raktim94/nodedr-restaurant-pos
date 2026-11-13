import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { closeSync, openSync, readSync, unlinkSync } from 'node:fs';
import { extname } from 'node:path';
import type { Request } from 'express';
import { diskStorage, type FileFilterCallback } from 'multer';
import { assertValidImageSignature, uploadsDir } from './image-upload.config';

// Adverts for the customer screen: pictures (jpg, png, webp, gif, up to 5 MB) and short videos
// (mp4 / H.264 or webm, up to 60 MB). Anything else is refused, and the bytes on disk are checked, not just the name.
const IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO = new Set(['.mp4', '.webm']);
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

export const mediaUploadOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir()),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: MAX_VIDEO_BYTES },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const ext = extname(file.originalname).toLowerCase();
    const ok = (IMAGE.has(ext) && file.mimetype.startsWith('image/')) || (VIDEO.has(ext) && file.mimetype.startsWith('video/'));
    if (!ok) return cb(new BadRequestException('Use a picture (jpg, png, webp, gif) or a video (mp4, webm)'));
    cb(null, true);
  },
};

/** Verifies the saved file really is what its extension says, and that a picture is within 5 MB. Returns the ad kind. */
export function checkMedia(file: Express.Multer.File): 'IMAGE' | 'VIDEO' {
  const ext = extname(file.filename).toLowerCase();
  try {
    if (IMAGE.has(ext)) {
      if (file.size > MAX_IMAGE_BYTES) throw new BadRequestException('Pictures can be at most 5 MB. Use a smaller or more compressed picture.');
      assertValidImageSignature(file.path);
      return 'IMAGE';
    }
    const fd = openSync(file.path, 'r');
    const b = Buffer.alloc(12);
    readSync(fd, b, 0, 12, 0);
    closeSync(fd);
    const mp4 = b.subarray(4, 8).toString('latin1') === 'ftyp';
    const webm = b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
    if ((ext === '.mp4' && mp4) || (ext === '.webm' && webm)) return 'VIDEO';
    throw new BadRequestException('That file is not a valid video');
  } catch (e) {
    try { unlinkSync(file.path); } catch { /* already gone */ }
    throw e;
  }
}
