import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import * as triggerService from '../services/triggers.js';
import { runPipeline } from '../extraction/pipeline.js';

const router = Router();

interface WebhookConfig {
  secret?: string;
  eventFilter?: string[];
}

function verifySignature(
  payload: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  // Handle both raw and prefixed signatures (e.g., sha256=...)
  const actualSignature = signature.replace(/^sha256=/, '');

  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(actualSignature)
  );
}

// Generic webhook receiver
router.post('/:triggerId', async (req: Request, res: Response) => {
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

    if (trigger.triggerType !== 'webhook') {
      res.status(400).json({ error: 'Not a webhook trigger' });
      return;
    }

    const config = trigger.triggerConfig as WebhookConfig;

    // Verify signature if secret is configured
    if (config.secret) {
      const signature =
        req.headers['x-hub-signature-256'] as string ||
        req.headers['x-signature'] as string ||
        req.headers['x-webhook-signature'] as string;

      const rawBody = JSON.stringify(req.body);

      if (!verifySignature(rawBody, signature, config.secret)) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }

    // Check event filter
    const eventType =
      req.headers['x-github-event'] as string ||
      req.headers['x-event-type'] as string ||
      req.body?.type ||
      'unknown';

    if (config.eventFilter && config.eventFilter.length > 0) {
      const matches = config.eventFilter.some((filter) => {
        // Support wildcards (e.g., "pull_request.*")
        if (filter.endsWith('*')) {
          return eventType.startsWith(filter.slice(0, -1));
        }
        return eventType === filter;
      });

      if (!matches) {
        res.status(200).json({ message: 'Event filtered out', eventType });
        return;
      }
    }

    // Extract content from webhook payload
    const content = extractContentFromWebhook(req.body, eventType);

    // Run extraction pipeline asynchronously
    res.status(202).json({ message: 'Webhook received, processing...' });

    // Process in background
    runPipeline({
      trigger,
      content,
      metadata: {
        eventType,
        source: 'webhook',
        receivedAt: new Date().toISOString(),
      },
    }).catch((error) => {
      console.error('Webhook pipeline error:', error);
    });
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function extractContentFromWebhook(
  payload: Record<string, unknown>,
  eventType: string
): string {
  // GitHub-specific extraction
  if (eventType.startsWith('pull_request')) {
    const pr = payload['pull_request'] as Record<string, unknown> | undefined;
    if (pr) {
      return `# Pull Request: ${pr['title']}

**Action:** ${payload['action']}
**Author:** ${(pr['user'] as Record<string, unknown> | undefined)?.['login']}
**Branch:** ${pr['head'] as string} → ${pr['base'] as string}

## Description
${pr['body'] || 'No description provided.'}

## Changes
- Additions: ${pr['additions']}
- Deletions: ${pr['deletions']}
- Changed files: ${pr['changed_files']}
`;
    }
  }

  if (eventType === 'push') {
    const commits = payload['commits'] as Array<Record<string, unknown>> | undefined;
    const commitMessages = commits
      ?.map((c) => `- ${c['message']}`)
      .join('\n') || 'No commits';

    return `# Push Event

**Repository:** ${(payload['repository'] as Record<string, unknown> | undefined)?.['full_name']}
**Branch:** ${(payload['ref'] as string)?.replace('refs/heads/', '')}
**Pusher:** ${(payload['pusher'] as Record<string, unknown> | undefined)?.['name']}

## Commits
${commitMessages}
`;
  }

  if (eventType === 'issues') {
    const issue = payload['issue'] as Record<string, unknown> | undefined;
    if (issue) {
      return `# Issue: ${issue['title']}

**Action:** ${payload['action']}
**Author:** ${(issue['user'] as Record<string, unknown> | undefined)?.['login']}
**State:** ${issue['state']}

## Body
${issue['body'] || 'No body provided.'}
`;
    }
  }

  // Generic fallback - stringify the payload
  return `# Webhook Event: ${eventType}

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`
`;
}

export default router;
