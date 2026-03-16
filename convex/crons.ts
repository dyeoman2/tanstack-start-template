import { anyApi, cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

crons.interval(
  'cleanup stale chat streams',
  { hours: 1 },
  internal.chatBackground.cleanupStaleChatRuns,
  {},
);

crons.interval(
  'cleanup expired regulated attachments',
  { hours: 6 },
  anyApi.security.cleanupExpiredAttachments,
  {},
);

export default crons;
