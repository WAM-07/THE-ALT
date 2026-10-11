import { z } from 'zod';
import { PLATFORMS, SELF_ROLES } from '../context.js';

export const Platform = z.enum(PLATFORMS);
export const ClientKind = z.enum(['app', 'web']).default('app');

export const Email = z.email().max(254).transform((v) => v.toLowerCase());
export const Password = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Use at least one letter and one number');
export const Handle = z.string().regex(/^[A-Za-z0-9_.]{3,30}$/, '3-30 letters, numbers, underscores or dots');
export const DisplayName = z.string().trim().min(1).max(80);
export const OtpCode = z.string().regex(/^\d{6}$/, 'A 6-digit code');
export const Address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'An Ethereum address')
  .transform((v) => v.toLowerCase());

/** Fields every "sign in" request carries so the session knows which app and device it belongs to. */
export const DeviceFields = {
  platform: Platform,
  deviceName: z.string().max(120).optional(),
  client: ClientKind,
};

export const SelfRole = z.enum(SELF_ROLES);
