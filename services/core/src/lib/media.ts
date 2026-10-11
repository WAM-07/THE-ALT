import type { MultipartFile } from '@fastify/multipart';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Ctx } from '../context.js';
import { randomToken } from './crypto.js';
import { badRequest } from './errors.js';

/** Only pictures served by ALT itself (or its Cloudinary account) may become an avatar: no tracking pixels. */
export function isTrustedMediaUrl(ctx: Ctx, url: string) {
  return url.startsWith(`${ctx.config.publicUrl}/`) || url.startsWith('https://res.cloudinary.com/');
}

const AVATAR_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/** Stores an uploaded avatar under STORAGE_DIR/avatars and returns its public URL (served by `/media/*`). */
export async function saveAvatar(ctx: Ctx, file: MultipartFile | undefined, owner: string) {
  if (!file) throw badRequest('FILE_REQUIRED', 'Attach an image file.');
  const ext = AVATAR_TYPES[file.mimetype];
  if (!ext) throw badRequest('UNSUPPORTED_TYPE', 'Use a PNG, JPEG or WebP image.');
  const name = `${owner}-${randomToken(6)}.${ext}`;
  const dir = path.resolve(ctx.config.storageDir, 'avatars');
  await mkdir(dir, { recursive: true });
  await pipeline(file.file, createWriteStream(path.join(dir, name)));
  if (file.file.truncated) {
    await unlink(path.join(dir, name)).catch(() => {});
    throw badRequest('FILE_TOO_LARGE', 'The image must be 5 MB or smaller.');
  }
  return `${ctx.config.publicUrl}/core/media/avatars/${name}`;
}
