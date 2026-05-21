import { z } from 'zod';
import { UUID_REGEX } from '@/shared/constants/index.js';

export const uuidSchema = z.string().regex(UUID_REGEX, 'Invalid UUID format');
