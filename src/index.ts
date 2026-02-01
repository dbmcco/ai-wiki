import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApiRouter } from './api/router.js';
import { getDb } from './db/client.js';
import { startCronScheduler, stopAllTasks } from './triggers/cron.js';
import { startFileWatchers, stopAllWatchers } from './triggers/file-watch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env['PORT'] ?? 3000;
const HOST = process.env['HOST'] ?? 'localhost';

async function main() {
  // Verify database connection
  const db = getDb();
  await db.query('SELECT 1');
  console.log('Database connected');

  // Set up Express
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // API routes
  app.use('/api/v1', createApiRouter());

  // Serve static UI
  app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'ui', 'index.html'));
  });

  const server = app.listen(PORT, () => {
    console.log(`AI Wiki server running at http://${HOST}:${PORT}`);
  });

  // Start trigger systems
  try {
    await startCronScheduler();
    await startFileWatchers();
  } catch (error) {
    console.warn('Failed to start some trigger systems:', error);
  }

  // Graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down...');
    stopAllTasks();
    stopAllWatchers();
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
