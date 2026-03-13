import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

crons.interval(
  'cleanup stale chat streams',
  { hours: 1 },
  internal.chatBackground.cleanupStaleChatRuns,
  {},
);

export default crons;
