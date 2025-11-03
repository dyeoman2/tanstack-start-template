/**
 * Capability Map - Single source of truth for role → capability mapping
 *
 * Capabilities are strings that represent specific permissions or access levels.
 * Roles are arrays of capabilities that users with that role possess.
 *
 * 'public' role includes capabilities available to unauthenticated users.
 */

export type Capability =
  | 'route:/app'
  | 'route:/app/admin'
  | 'route:/app/admin.users'
  | 'route:/app/admin.stats'
  | 'route:/app/profile'
  | 'user.write'
  | 'user.bootstrap'
  | 'profile.read'
  | 'profile.write'
  | 'util.firstUserCheck'
  | 'util.emailServiceStatus'
  | 'dashboard.read';

export const Caps = {
  'route:/app': ['user', 'admin'],
  'route:/app/admin': ['admin'],
  'route:/app/admin.users': ['admin'],
  'route:/app/admin.stats': ['admin'],
  'route:/app/profile': ['user', 'admin'],
  'user.write': ['admin'],
  'user.bootstrap': ['public', 'user', 'admin'], // Bootstrap allowed for everyone, but logic restricts it
  'profile.read': ['user', 'admin'],
  'profile.write': ['user', 'admin'],
  'util.firstUserCheck': ['public', 'user', 'admin'],
  'util.emailServiceStatus': ['public', 'user', 'admin'],
  'dashboard.read': ['admin'], // Admin dashboard data
} as const;

export const PublicCaps = new Set<Capability>([
  'util.firstUserCheck',
  'util.emailServiceStatus',
  'user.bootstrap',
]);
