import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/client.js';
import * as tenantService from '../services/tenants.js';
import { runGardening, formatGardeningReport } from '../agents/gardener.js';

const router = Router({ mergeParams: true });

// Helper to get tenant from params
async function getTenant(req: Request, res: Response) {
  const tenant = await tenantService.getTenantBySlug(req.params['tenant']!);
  if (!tenant) {
    res.status(404).json({ error: 'Tenant not found' });
    return null;
  }
  return tenant;
}

// Get wiki stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;

    const stats = await queryOne<{
      documents_total: string;
      documents_with_embeddings: string;
      documents_archived: string;
      links_total: string;
      namespaces_count: string;
      triggers_active: string;
      recent_executions: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM documents WHERE tenant_id = $1 AND is_archived = FALSE) as documents_total,
         (SELECT COUNT(*) FROM documents WHERE tenant_id = $1 AND is_archived = FALSE AND content_embedding IS NOT NULL) as documents_with_embeddings,
         (SELECT COUNT(*) FROM documents WHERE tenant_id = $1 AND is_archived = TRUE) as documents_archived,
         (SELECT COUNT(*) FROM links l JOIN documents d ON d.id = l.source_id WHERE d.tenant_id = $1) as links_total,
         (SELECT COUNT(*) FROM namespaces WHERE tenant_id = $1) as namespaces_count,
         (SELECT COUNT(*) FROM triggers WHERE tenant_id = $1 AND is_active = TRUE) as triggers_active,
         (SELECT COUNT(*) FROM trigger_executions te JOIN triggers t ON t.id = te.trigger_id WHERE t.tenant_id = $1 AND te.started_at > NOW() - INTERVAL '7 days') as recent_executions`,
      [tenant.id]
    );

    res.json({
      documents: {
        total: parseInt(stats?.documents_total ?? '0', 10),
        withEmbeddings: parseInt(stats?.documents_with_embeddings ?? '0', 10),
        archived: parseInt(stats?.documents_archived ?? '0', 10),
      },
      links: parseInt(stats?.links_total ?? '0', 10),
      namespaces: parseInt(stats?.namespaces_count ?? '0', 10),
      triggers: {
        active: parseInt(stats?.triggers_active ?? '0', 10),
        recentExecutions: parseInt(stats?.recent_executions ?? '0', 10),
      },
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Get activity over time
router.get('/activity', async (req: Request, res: Response) => {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;

    const days = parseInt(req.query['days'] as string) || 30;

    const activity = await query<{
      date: Date;
      documents_created: string;
      documents_updated: string;
    }>(
      `SELECT
         DATE(created_at) as date,
         COUNT(*) FILTER (WHERE DATE(created_at) = DATE(updated_at)) as documents_created,
         COUNT(*) FILTER (WHERE DATE(created_at) < DATE(updated_at)) as documents_updated
       FROM documents
       WHERE tenant_id = $1
         AND updated_at > NOW() - INTERVAL '${days} days'
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      [tenant.id]
    );

    res.json({
      activity: activity.rows.map((row) => ({
        date: row.date,
        created: parseInt(row.documents_created, 10),
        updated: parseInt(row.documents_updated, 10),
      })),
    });
  } catch (error) {
    console.error('Error getting activity:', error);
    res.status(500).json({ error: 'Failed to get activity' });
  }
});

// Get top documents by backlinks
router.get('/top-documents', async (req: Request, res: Response) => {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;

    const limit = parseInt(req.query['limit'] as string) || 10;

    const topDocs = await query<{
      id: string;
      slug: string;
      title: string;
      backlink_count: string;
    }>(
      `SELECT d.id, d.slug, d.title, COUNT(l.id) as backlink_count
       FROM documents d
       LEFT JOIN links l ON l.target_id = d.id
       WHERE d.tenant_id = $1 AND d.is_archived = FALSE
       GROUP BY d.id
       ORDER BY backlink_count DESC
       LIMIT $2`,
      [tenant.id, limit]
    );

    res.json({
      documents: topDocs.rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        backlinkCount: parseInt(row.backlink_count, 10),
      })),
    });
  } catch (error) {
    console.error('Error getting top documents:', error);
    res.status(500).json({ error: 'Failed to get top documents' });
  }
});

// Get source type breakdown
router.get('/sources', async (req: Request, res: Response) => {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;

    const sources = await query<{
      source_type: string | null;
      count: string;
    }>(
      `SELECT COALESCE(source_type, 'manual') as source_type, COUNT(*) as count
       FROM documents
       WHERE tenant_id = $1 AND is_archived = FALSE
       GROUP BY source_type
       ORDER BY count DESC`,
      [tenant.id]
    );

    res.json({
      sources: sources.rows.map((row) => ({
        sourceType: row.source_type,
        count: parseInt(row.count, 10),
      })),
    });
  } catch (error) {
    console.error('Error getting sources:', error);
    res.status(500).json({ error: 'Failed to get sources' });
  }
});

// Run gardening and get report
router.post('/gardening', async (req: Request, res: Response) => {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;

    const namespaceSlug = req.query['namespace'] as string | undefined;

    const report = await runGardening({
      tenantId: tenant.id,
      namespaceId: namespaceSlug,
      autoLink: req.body.autoLink !== false,
      detectConflicts: req.body.detectConflicts !== false,
      findOrphans: req.body.findOrphans !== false,
      findOutdated: req.body.findOutdated !== false,
    });

    // Return formatted report if requested
    if (req.query['format'] === 'markdown') {
      res.type('text/markdown').send(formatGardeningReport(report));
    } else {
      res.json(report);
    }
  } catch (error) {
    console.error('Error running gardening:', error);
    res.status(500).json({ error: 'Failed to run gardening' });
  }
});

export default router;
