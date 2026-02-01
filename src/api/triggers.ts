import { Router, Request, Response } from 'express';
import * as triggerService from '../services/triggers.js';
import * as executionService from '../services/executions.js';
import * as tenantService from '../services/tenants.js';
import { reloadTrigger as reloadCronTrigger } from '../triggers/cron.js';
import { reloadWatcher } from '../triggers/file-watch.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const createTriggerSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  triggerType: z.enum(['webhook', 'cron', 'file_watch', 'manual']),
  triggerConfig: z.record(z.unknown()),
  agentModel: z.string().optional(),
  agentSystemPrompt: z.string().optional(),
  agentExtractionTemplate: z.string().optional(),
  targetNamespace: z.string().optional(),
  routingRules: z.object({
    defaultNamespace: z.string().optional(),
    conditional: z.array(z.object({
      match: z.record(z.unknown()),
      namespace: z.string(),
    })).optional(),
    autoLink: z.object({
      enabled: z.boolean(),
      similarityThreshold: z.number().optional(),
    }).optional(),
  }).optional(),
});

const updateTriggerSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  triggerConfig: z.record(z.unknown()).optional(),
  agentModel: z.string().optional(),
  agentSystemPrompt: z.string().optional(),
  agentExtractionTemplate: z.string().optional(),
  targetNamespace: z.string().optional(),
  routingRules: z.object({
    defaultNamespace: z.string().optional(),
    conditional: z.array(z.object({
      match: z.record(z.unknown()),
      namespace: z.string(),
    })).optional(),
    autoLink: z.object({
      enabled: z.boolean(),
      similarityThreshold: z.number().optional(),
    }).optional(),
  }).optional(),
  isActive: z.boolean().optional(),
});

// Helper to get tenant from params
async function getTenant(req: Request, res: Response) {
  const tenant = await tenantService.getTenantBySlug(req.params['tenant']!);
  if (!tenant) {
    res.status(404).json({ error: 'Tenant not found' });
    return null;
  }
  return tenant;
}

// List triggers
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;

    const triggers = await triggerService.listTriggers(tenant.id);
    res.json({ triggers });
  } catch (error) {
    console.error('Error listing triggers:', error);
    res.status(500).json({ error: 'Failed to list triggers' });
  }
});

// Create trigger
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;

    const input = createTriggerSchema.parse(req.body);

    const trigger = await triggerService.createTrigger({
      tenantId: tenant.id,
      name: input.name,
      description: input.description,
      triggerType: input.triggerType,
      triggerConfig: input.triggerConfig,
      agentModel: input.agentModel,
      agentSystemPrompt: input.agentSystemPrompt,
      agentExtractionTemplate: input.agentExtractionTemplate,
      routingRules: input.routingRules,
    });

    // Start the trigger if it's cron or file_watch
    if (trigger.triggerType === 'cron') {
      await reloadCronTrigger(trigger.id);
    } else if (trigger.triggerType === 'file_watch') {
      await reloadWatcher(trigger.id);
    }

    res.status(201).json(trigger);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    console.error('Error creating trigger:', error);
    res.status(500).json({ error: 'Failed to create trigger' });
  }
});

// Get trigger
router.get('/:triggerId', async (req: Request, res: Response) => {
  try {
    const trigger = await triggerService.getTriggerById(req.params['triggerId']!);
    if (!trigger) {
      res.status(404).json({ error: 'Trigger not found' });
      return;
    }
    res.json(trigger);
  } catch (error) {
    console.error('Error getting trigger:', error);
    res.status(500).json({ error: 'Failed to get trigger' });
  }
});

// Update trigger
router.patch('/:triggerId', async (req: Request, res: Response) => {
  try {
    const trigger = await triggerService.getTriggerById(req.params['triggerId']!);
    if (!trigger) {
      res.status(404).json({ error: 'Trigger not found' });
      return;
    }

    const input = updateTriggerSchema.parse(req.body);

    const updated = await triggerService.updateTrigger(trigger.id, {
      name: input.name,
      description: input.description,
      triggerConfig: input.triggerConfig,
      agentModel: input.agentModel,
      agentSystemPrompt: input.agentSystemPrompt,
      agentExtractionTemplate: input.agentExtractionTemplate,
      routingRules: input.routingRules,
      isActive: input.isActive,
    });

    // Reload the trigger if it's cron or file_watch
    if (updated?.triggerType === 'cron') {
      await reloadCronTrigger(updated.id);
    } else if (updated?.triggerType === 'file_watch') {
      await reloadWatcher(updated.id);
    }

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    console.error('Error updating trigger:', error);
    res.status(500).json({ error: 'Failed to update trigger' });
  }
});

// Delete trigger
router.delete('/:triggerId', async (req: Request, res: Response) => {
  try {
    const trigger = await triggerService.getTriggerById(req.params['triggerId']!);
    if (!trigger) {
      res.status(404).json({ error: 'Trigger not found' });
      return;
    }

    await triggerService.deleteTrigger(trigger.id);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting trigger:', error);
    res.status(500).json({ error: 'Failed to delete trigger' });
  }
});

// Get trigger executions
router.get('/:triggerId/executions', async (req: Request, res: Response) => {
  try {
    const trigger = await triggerService.getTriggerById(req.params['triggerId']!);
    if (!trigger) {
      res.status(404).json({ error: 'Trigger not found' });
      return;
    }

    const executions = await executionService.listExecutions(
      trigger.id,
      parseInt(req.query['limit'] as string) || 50,
      parseInt(req.query['offset'] as string) || 0
    );

    const successCount = await executionService.countExecutions(trigger.id, 'success');
    const failedCount = await executionService.countExecutions(trigger.id, 'failed');

    res.json({
      executions,
      stats: {
        success: successCount,
        failed: failedCount,
      },
    });
  } catch (error) {
    console.error('Error getting executions:', error);
    res.status(500).json({ error: 'Failed to get executions' });
  }
});

export default router;
