import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApiRouter } from '../src/api/router.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// API routes
app.use('/api/v1', createApiRouter());

// Cron endpoint for Vercel Cron
app.get('/api/v1/cron/gardening', async (req, res) => {
  // Verify cron secret in production
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const { scheduleGardening } = await import('../src/agents/gardener.js');
    const { listTenants } = await import('../src/services/tenants.js');

    // Run gardening for all tenants
    const tenants = await listTenants();
    const results = [];

    for (const tenant of tenants) {
      const report = await scheduleGardening(tenant.id);
      results.push({
        tenant: tenant.slug,
        orphans: report.stats.documentsOrphaned,
        conflicts: report.stats.conflictsDetected,
        autoLinks: report.stats.autoLinksCreated,
      });
    }

    res.json({ success: true, results });
  } catch (error) {
    console.error('Cron gardening error:', error);
    res.status(500).json({ error: 'Gardening failed' });
  }
});

// Serve UI
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'src', 'ui', 'index.html'));
});

// Export for Vercel
export default app;
