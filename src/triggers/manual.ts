import { Router, Request, Response } from 'express';
import * as triggerService from '../services/triggers.js';
import { runPipeline } from '../extraction/pipeline.js';
import { z } from 'zod';

const router = Router();

const executeManualSchema = z.object({
  content: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

// Execute a manual trigger
router.post('/:triggerId/execute', async (req: Request, res: Response) => {
  const { triggerId } = req.params;

  try {
    const trigger = await triggerService.getTriggerById(triggerId!);

    if (!trigger) {
      res.status(404).json({ error: 'Trigger not found' });
      return;
    }

    if (!trigger.isActive) {
      res.status(400).json({ error: 'Trigger is not active' });
      return;
    }

    if (trigger.triggerType !== 'manual') {
      res.status(400).json({ error: 'Not a manual trigger' });
      return;
    }

    const input = executeManualSchema.parse(req.body);

    // Run pipeline synchronously for manual triggers
    const result = await runPipeline({
      trigger,
      content: input.content,
      metadata: {
        ...input.metadata,
        source: 'manual',
        executedAt: new Date().toISOString(),
      },
    });

    if (result.success) {
      res.json({
        success: true,
        executionId: result.executionId,
        documentsCreated: result.documentsCreated.length,
        documentsUpdated: result.documentsUpdated.length,
        linksCreated: result.linksCreated,
      });
    } else {
      res.status(500).json({
        success: false,
        executionId: result.executionId,
        error: result.error,
      });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    console.error('Manual trigger error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Quick extract endpoint - runs extraction without a configured trigger
router.post('/extract', async (req: Request, res: Response) => {
  try {
    const { tenantId, namespaceId, content, sourceType, sourceRef } = req.body;

    if (!tenantId || !content) {
      res.status(400).json({ error: 'tenantId and content are required' });
      return;
    }

    // Create an ephemeral trigger for this extraction
    const ephemeralTrigger = {
      id: 'ephemeral',
      tenantId,
      name: 'Quick Extract',
      triggerType: 'manual' as const,
      triggerConfig: {},
      agentModel: 'claude-sonnet-4-20250514',
      targetNamespaceId: namespaceId,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await runPipeline({
      trigger: ephemeralTrigger,
      content,
      metadata: {
        source: 'quick-extract',
        sourceType,
        sourceRef,
        executedAt: new Date().toISOString(),
      },
    });

    res.json({
      success: result.success,
      documentsCreated: result.documentsCreated,
      documentsUpdated: result.documentsUpdated,
      linksCreated: result.linksCreated,
      error: result.error,
    });
  } catch (error) {
    console.error('Quick extract error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
