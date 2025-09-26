import type { User as DefaultUser } from 'better-auth';

declare module 'better-auth' {
  interface User extends DefaultUser {
    role?: 'user' | 'admin';
  }
}
