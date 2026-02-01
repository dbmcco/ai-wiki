import { Router } from 'express';
import tenantsRouter from './tenants.js';
import documentsRouter from './documents.js';
import triggersRouter from './triggers.js';
import analyticsRouter from './analytics.js';
import webhookRouter from '../triggers/webhook.js';
import manualRouter from '../triggers/manual.js';

export function createApiRouter(): Router {
  const router = Router();

  // Tenant and namespace routes
  router.use('/tenants', tenantsRouter);

  // Document routes (nested under tenant)
  router.use('/tenants/:tenant/documents', documentsRouter);

  // Trigger routes (nested under tenant)
  router.use('/tenants/:tenant/triggers', triggersRouter);

  // Analytics routes (nested under tenant)
  router.use('/tenants/:tenant/analytics', analyticsRouter);

  // Webhook receiver (not nested under tenant - uses trigger ID directly)
  router.use('/webhooks', webhookRouter);

  // Manual trigger execution
  router.use('/triggers', manualRouter);

  return router;
}
