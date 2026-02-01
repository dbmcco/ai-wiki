import fs from 'fs';
import path from 'path';
import * as triggerService from '../services/triggers.js';
import { runPipeline } from '../extraction/pipeline.js';

interface FileWatchConfig {
  path: string;
  patterns: string[];
  poll_interval?: number; // seconds
}

interface FileWatcher {
  triggerId: string;
  interval: ReturnType<typeof setInterval>;
  processedFiles: Set<string>;
}

const watchers: Map<string, FileWatcher> = new Map();

export async function startFileWatchers(): Promise<void> {
  console.log('Starting file watchers...');

  const triggers = await triggerService.getActiveTriggersByType('file_watch');

  for (const trigger of triggers) {
    startWatcher(trigger.id, trigger.triggerConfig as unknown as FileWatchConfig);
  }

  console.log(`Started ${watchers.size} file watchers`);
}

export function startWatcher(triggerId: string, config: FileWatchConfig): boolean {
  // Stop existing watcher if any
  stopWatcher(triggerId);

  const watchPath = config.path;
  const pollInterval = (config.poll_interval || 60) * 1000;

  // Verify path exists
  if (!fs.existsSync(watchPath)) {
    console.error(`Watch path does not exist for trigger ${triggerId}: ${watchPath}`);
    return false;
  }

  const processedFiles = new Set<string>();

  // Initial scan to mark existing files as processed
  const existingFiles = scanDirectory(watchPath, config.patterns);
  for (const file of existingFiles) {
    processedFiles.add(file);
  }

  const interval = setInterval(async () => {
    await checkForNewFiles(triggerId, config, processedFiles);
  }, pollInterval);

  watchers.set(triggerId, { triggerId, interval, processedFiles });
  console.log(`Started file watcher for trigger ${triggerId}: ${watchPath}`);

  return true;
}

export function stopWatcher(triggerId: string): void {
  const watcher = watchers.get(triggerId);
  if (watcher) {
    clearInterval(watcher.interval);
    watchers.delete(triggerId);
    console.log(`Stopped file watcher for trigger ${triggerId}`);
  }
}

export function stopAllWatchers(): void {
  for (const [triggerId, watcher] of watchers) {
    clearInterval(watcher.interval);
    console.log(`Stopped file watcher for trigger ${triggerId}`);
  }
  watchers.clear();
}

function scanDirectory(dirPath: string, patterns: string[]): string[] {
  const files: string[] = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        files.push(...scanDirectory(fullPath, patterns));
      } else if (entry.isFile()) {
        // Check if file matches any pattern
        if (matchesPatterns(entry.name, patterns)) {
          files.push(fullPath);
        }
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dirPath}:`, error);
  }

  return files;
}

function matchesPatterns(filename: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Simple glob matching (*.txt, *.md, etc.)
    if (pattern.startsWith('*.')) {
      const ext = pattern.slice(1);
      if (filename.endsWith(ext)) {
        return true;
      }
    } else if (filename === pattern) {
      return true;
    }
  }
  return false;
}

async function checkForNewFiles(
  triggerId: string,
  config: FileWatchConfig,
  processedFiles: Set<string>
): Promise<void> {
  const trigger = await triggerService.getTriggerById(triggerId);

  if (!trigger || !trigger.isActive) {
    console.log(`Trigger ${triggerId} is no longer active, stopping watcher`);
    stopWatcher(triggerId);
    return;
  }

  const currentFiles = scanDirectory(config.path, config.patterns);

  for (const file of currentFiles) {
    if (!processedFiles.has(file)) {
      console.log(`New file detected: ${file}`);
      processedFiles.add(file);

      try {
        await processFile(trigger, file);
      } catch (error) {
        console.error(`Error processing file ${file}:`, error);
      }
    }
  }
}

async function processFile(
  trigger: Awaited<ReturnType<typeof triggerService.getTriggerById>>,
  filePath: string
): Promise<void> {
  if (!trigger) return;

  const content = fs.readFileSync(filePath, 'utf-8');
  const filename = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  // Format content based on file type
  let formattedContent: string;

  if (ext === '.vtt' || ext === '.srt') {
    formattedContent = `# Transcript: ${filename}

${parseTranscript(content)}
`;
  } else if (ext === '.json') {
    formattedContent = `# JSON File: ${filename}

\`\`\`json
${content}
\`\`\`
`;
  } else {
    formattedContent = `# File: ${filename}

${content}
`;
  }

  await runPipeline({
    trigger,
    content: formattedContent,
    metadata: {
      filename,
      filePath,
      fileType: ext,
      processedAt: new Date().toISOString(),
    },
  });
}

function parseTranscript(content: string): string {
  // Simple VTT/SRT to text conversion
  // Remove timestamps and formatting
  return content
    .replace(/^\d+$/gm, '') // Remove cue numbers
    .replace(/\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/g, '') // Remove timestamps
    .replace(/^WEBVTT.*$/gm, '') // Remove VTT header
    .replace(/<[^>]+>/g, '') // Remove HTML tags
    .replace(/\n{3,}/g, '\n\n') // Collapse multiple newlines
    .trim();
}

// Reload a specific trigger's watcher
export async function reloadWatcher(triggerId: string): Promise<boolean> {
  const trigger = await triggerService.getTriggerById(triggerId);

  if (!trigger) {
    stopWatcher(triggerId);
    return false;
  }

  if (!trigger.isActive || trigger.triggerType !== 'file_watch') {
    stopWatcher(triggerId);
    return false;
  }

  return startWatcher(triggerId, trigger.triggerConfig as unknown as FileWatchConfig);
}
