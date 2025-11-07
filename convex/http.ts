import { httpRouter } from 'convex/server';
import { authComponent, createAuth } from './auth';
import { healthCheck } from './health';

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

// Health check endpoint
http.route({
  path: '/health',
  method: 'GET',
  handler: healthCheck,
});

export default http;
