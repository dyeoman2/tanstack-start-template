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
  'route:/app': ['user', 'staff', 'admin'],
  'route:/app/admin': ['admin'],
  'route:/app/admin.users': ['admin'],
  'route:/app/admin.stats': ['admin'],
  'route:/app/profile': ['user', 'staff', 'admin'],
  'user.write': ['admin'],
  'user.bootstrap': ['public', 'user', 'staff', 'admin'], // Bootstrap allowed for everyone, but logic restricts it
  'profile.read': ['user', 'staff', 'admin'],
  'profile.write': ['user', 'staff', 'admin'],
  'util.firstUserCheck': ['public', 'user', 'staff', 'admin'],
  'util.emailServiceStatus': ['public', 'user', 'staff', 'admin'],
  'dashboard.read': ['user', 'staff', 'admin'],
} as const;

export const PublicCaps = new Set<Capability>([
  'util.firstUserCheck',
  'util.emailServiceStatus',
  'user.bootstrap',
]);
