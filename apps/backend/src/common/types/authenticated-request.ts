import type { SessionUser } from '@restrovia/types';
import type { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user: SessionUser;
}
