import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = Symbol('IS_PUBLIC');

/** Marks a route as reachable without a session. Only auth and health routes use it (05 §1). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
