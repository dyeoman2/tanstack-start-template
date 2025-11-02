import betterAuth from '@convex-dev/better-auth/convex.config';
import rateLimiter from '@convex-dev/rate-limiter/convex.config';
import resend from '@convex-dev/resend/convex.config';
import autumn from '@useautumn/convex/convex.config';
import { defineApp } from 'convex/server';

const app = defineApp();
app.use(betterAuth);
app.use(resend);
app.use(rateLimiter);
app.use(autumn);

export default app;
