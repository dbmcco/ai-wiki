import cron from 'node-cron';
import * as triggerService from '../services/triggers.js';
import { runPipeline } from '../extraction/pipeline.js';
import { runSimpleExtraction } from '../extraction/agents.js';

interface CronConfig {
  schedule: string;
  task: {
    type: 'web_research' | 'aggregation' | 'gardening' | 'custom';
    query_template?: string;
    topics?: string[];
    custom_prompt?: string;
  };
}

interface ScheduledTask {
  triggerId: string;
  task: cron.ScheduledTask;
}

const scheduledTasks: Map<string, ScheduledTask> = new Map();

export async function startCronScheduler(): Promise<void> {
  console.log('Starting cron scheduler...');

  // Load all active cron triggers
  const triggers = await triggerService.getActiveTriggersByType('cron');

  for (const trigger of triggers) {
    scheduleTask(trigger.id, trigger.triggerConfig as unknown as CronConfig);
  }

  console.log(`Scheduled ${scheduledTasks.size} cron tasks`);
}

export function scheduleTask(triggerId: string, config: CronConfig): boolean {
  // Validate cron expression
  if (!cron.validate(config.schedule)) {
    console.error(`Invalid cron expression for trigger ${triggerId}: ${config.schedule}`);
    return false;
  }

  // Stop existing task if any
  stopTask(triggerId);

  const task = cron.schedule(config.schedule, async () => {
    await executeCronTask(triggerId);
  });

  scheduledTasks.set(triggerId, { triggerId, task });
  console.log(`Scheduled task for trigger ${triggerId}: ${config.schedule}`);

  return true;
}

export function stopTask(triggerId: string): void {
  const scheduled = scheduledTasks.get(triggerId);
  if (scheduled) {
    scheduled.task.stop();
    scheduledTasks.delete(triggerId);
    console.log(`Stopped task for trigger ${triggerId}`);
  }
}

export function stopAllTasks(): void {
  for (const [triggerId, scheduled] of scheduledTasks) {
    scheduled.task.stop();
    console.log(`Stopped task for trigger ${triggerId}`);
  }
  scheduledTasks.clear();
}

async function executeCronTask(triggerId: string): Promise<void> {
  console.log(`Executing cron task for trigger ${triggerId}`);

  try {
    const trigger = await triggerService.getTriggerById(triggerId);

    if (!trigger || !trigger.isActive) {
      console.log(`Trigger ${triggerId} is no longer active, skipping`);
      stopTask(triggerId);
      return;
    }

    const config = trigger.triggerConfig as unknown as CronConfig;

    // Generate content based on task type
    let content: string;

    switch (config.task.type) {
      case 'web_research':
        content = await performWebResearch(config.task);
        break;

      case 'aggregation':
        content = await performAggregation(config.task);
        break;

      case 'gardening':
        content = await performGardening(config.task);
        break;

      case 'custom':
        if (config.task.custom_prompt) {
          content = await runSimpleExtraction('', config.task.custom_prompt);
        } else {
          content = 'Custom task with no prompt configured';
        }
        break;

      default:
        content = `Unknown task type: ${config.task.type}`;
    }

    // Run extraction pipeline
    await runPipeline({
      trigger,
      content,
      metadata: {
        taskType: config.task.type,
        executedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`Cron task error for trigger ${triggerId}:`, error);
  }
}

async function performWebResearch(task: CronConfig['task']): Promise<string> {
  const topics = task.topics || [];
  const template = task.query_template || 'Latest developments in {{topic}}';

  // In a real implementation, this would call Perplexity or similar
  // For now, generate a placeholder that the extraction agent can work with
  const sections = topics.map((topic) => {
    const query = template.replace('{{topic}}', topic);
    return `## Research: ${topic}

Query: ${query}

[Web research results would be inserted here by integration with Perplexity/similar API]
`;
  });

  return `# Web Research Report

Generated: ${new Date().toISOString()}

${sections.join('\n\n')}
`;
}

async function performAggregation(_task: CronConfig['task']): Promise<string> {
  // Placeholder for aggregation logic
  return `# Aggregation Report

Generated: ${new Date().toISOString()}

[Aggregation of recent documents/changes would be performed here]
`;
}

async function performGardening(_task: CronConfig['task']): Promise<string> {
  // Placeholder for gardening logic
  return `# Gardening Report

Generated: ${new Date().toISOString()}

[Analysis of wiki health, orphaned pages, missing links, etc.]
`;
}

// Reload a specific trigger's schedule
export async function reloadTrigger(triggerId: string): Promise<boolean> {
  const trigger = await triggerService.getTriggerById(triggerId);

  if (!trigger) {
    stopTask(triggerId);
    return false;
  }

  if (!trigger.isActive || trigger.triggerType !== 'cron') {
    stopTask(triggerId);
    return false;
  }

  return scheduleTask(triggerId, trigger.triggerConfig as unknown as CronConfig);
}
