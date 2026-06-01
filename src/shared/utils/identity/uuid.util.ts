import { z } from 'zod';
import { UUID_REGEX } from '@/shared/constants/index.js';

/** Reusable Zod schema for a canonical 8-4-4-4-12 UUID string (case-insensitive). */
export const uuidSchema = z.string().regex(UUID_REGEX, 'Invalid UUID format');
