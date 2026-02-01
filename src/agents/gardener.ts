import * as autoLinkService from '../services/auto-link.js';
import * as conflictService from '../services/conflicts.js';
import { query } from '../db/client.js';

export interface GardeningOptions {
  tenantId: string;
  namespaceId?: string;
  autoLink?: boolean;
  detectConflicts?: boolean;
  findOrphans?: boolean;
  findOutdated?: boolean;
  similarityThreshold?: number;
  outdatedDaysThreshold?: number;
}

export interface GardeningReport {
  timestamp: Date;
  tenantId: string;
  namespaceId?: string;
  stats: {
    documentsTotal: number;
    documentsWithEmbeddings: number;
    documentsOrphaned: number;
    documentsOutdated: number;
    linksTotal: number;
    autoLinksCreated: number;
    conflictsDetected: number;
  };
  orphanedDocuments: {
    id: string;
    slug: string;
    title: string;
  }[];
  outdatedDocuments: {
    id: string;
    slug: string;
    title: string;
    lastUpdated: Date;
  }[];
  conflicts: {
    doc1Slug: string;
    doc2Slug: string;
    similarity: number;
    conflictType?: string;
    recommendation: string;
  }[];
  autoLinkResults: {
    documentsProcessed: number;
    linksCreated: number;
  };
}

export async function runGardening(options: GardeningOptions): Promise<GardeningReport> {
  const {
    tenantId,
    namespaceId,
    autoLink = true,
    detectConflicts = true,
    findOrphans = true,
    findOutdated = true,
    similarityThreshold = 0.75,
    outdatedDaysThreshold = 180,
  } = options;

  const report: GardeningReport = {
    timestamp: new Date(),
    tenantId,
    namespaceId,
    stats: {
      documentsTotal: 0,
      documentsWithEmbeddings: 0,
      documentsOrphaned: 0,
      documentsOutdated: 0,
      linksTotal: 0,
      autoLinksCreated: 0,
      conflictsDetected: 0,
    },
    orphanedDocuments: [],
    outdatedDocuments: [],
    conflicts: [],
    autoLinkResults: {
      documentsProcessed: 0,
      linksCreated: 0,
    },
  };

  // Get basic stats
  const statsResult = await query<{
    total: string;
    with_embeddings: string;
    links_total: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM documents WHERE tenant_id = $1 AND ($2::uuid IS NULL OR namespace_id = $2) AND is_archived = FALSE) as total,
       (SELECT COUNT(*) FROM documents WHERE tenant_id = $1 AND ($2::uuid IS NULL OR namespace_id = $2) AND is_archived = FALSE AND content_embedding IS NOT NULL) as with_embeddings,
       (SELECT COUNT(*) FROM links l JOIN documents d ON d.id = l.source_id WHERE d.tenant_id = $1 AND ($2::uuid IS NULL OR d.namespace_id = $2)) as links_total`,
    [tenantId, namespaceId ?? null]
  );

  const stats = statsResult.rows[0];
  if (stats) {
    report.stats.documentsTotal = parseInt(stats.total, 10);
    report.stats.documentsWithEmbeddings = parseInt(stats.with_embeddings, 10);
    report.stats.linksTotal = parseInt(stats.links_total, 10);
  }

  // Find orphaned documents
  if (findOrphans) {
    const orphans = await autoLinkService.findOrphanedDocuments(tenantId, namespaceId);
    report.stats.documentsOrphaned = orphans.length;
    report.orphanedDocuments = orphans.map((d) => ({
      id: d.id,
      slug: d.slug,
      title: d.title,
    }));
  }

  // Find outdated documents
  if (findOutdated) {
    const outdated = await conflictService.findPotentiallyOutdated(tenantId, outdatedDaysThreshold);
    report.stats.documentsOutdated = outdated.length;
    report.outdatedDocuments = outdated.map((d) => ({
      id: d.id,
      slug: d.slug,
      title: d.title,
      lastUpdated: d.updatedAt,
    }));
  }

  // Detect conflicts
  if (detectConflicts) {
    const conflictReports = await conflictService.detectConflicts(tenantId, namespaceId, {
      similarityThreshold: 0.85,
      analyzeWithAI: false, // Use heuristics for speed
      maxCandidates: 20,
    });

    report.stats.conflictsDetected = conflictReports.filter((r) => r.analysis.hasConflict).length;
    report.conflicts = conflictReports
      .filter((r) => r.analysis.hasConflict)
      .map((r) => ({
        doc1Slug: r.candidate.doc1.slug,
        doc2Slug: r.candidate.doc2.slug,
        similarity: r.candidate.similarity,
        conflictType: r.analysis.conflictType,
        recommendation: r.analysis.recommendation,
      }));
  }

  // Auto-link documents
  if (autoLink) {
    const autoLinkResult = await autoLinkService.bulkAutoLink({
      tenantId,
      namespaceId,
      similarityThreshold,
      maxLinksPerDoc: 3,
    });

    report.autoLinkResults = {
      documentsProcessed: autoLinkResult.documentsProcessed,
      linksCreated: autoLinkResult.totalLinksCreated,
    };
    report.stats.autoLinksCreated = autoLinkResult.totalLinksCreated;
  }

  return report;
}

// Scheduled gardening task
export async function scheduleGardening(
  tenantId: string,
  namespaceId?: string
): Promise<GardeningReport> {
  console.log(`Running scheduled gardening for tenant ${tenantId}`);

  const report = await runGardening({
    tenantId,
    namespaceId,
    autoLink: true,
    detectConflicts: true,
    findOrphans: true,
    findOutdated: true,
  });

  console.log(`Gardening complete:`, {
    orphans: report.stats.documentsOrphaned,
    outdated: report.stats.documentsOutdated,
    conflicts: report.stats.conflictsDetected,
    autoLinks: report.stats.autoLinksCreated,
  });

  return report;
}

// Generate markdown report
export function formatGardeningReport(report: GardeningReport): string {
  const lines = [
    `# Wiki Gardening Report`,
    ``,
    `**Generated:** ${report.timestamp.toISOString()}`,
    `**Tenant:** ${report.tenantId}`,
    report.namespaceId ? `**Namespace:** ${report.namespaceId}` : '',
    ``,
    `## Summary`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total Documents | ${report.stats.documentsTotal} |`,
    `| With Embeddings | ${report.stats.documentsWithEmbeddings} |`,
    `| Orphaned (no links) | ${report.stats.documentsOrphaned} |`,
    `| Potentially Outdated | ${report.stats.documentsOutdated} |`,
    `| Total Links | ${report.stats.linksTotal} |`,
    `| Auto-links Created | ${report.stats.autoLinksCreated} |`,
    `| Conflicts Detected | ${report.stats.conflictsDetected} |`,
    ``,
  ];

  if (report.orphanedDocuments.length > 0) {
    lines.push(`## Orphaned Documents`);
    lines.push(``);
    lines.push(`These documents have no incoming or outgoing links:`);
    lines.push(``);
    for (const doc of report.orphanedDocuments) {
      lines.push(`- **${doc.title}** (${doc.slug})`);
    }
    lines.push(``);
  }

  if (report.outdatedDocuments.length > 0) {
    lines.push(`## Potentially Outdated Documents`);
    lines.push(``);
    lines.push(`These documents haven't been updated recently:`);
    lines.push(``);
    for (const doc of report.outdatedDocuments) {
      lines.push(`- **${doc.title}** (${doc.slug}) - Last updated: ${doc.lastUpdated.toISOString().split('T')[0]}`);
    }
    lines.push(``);
  }

  if (report.conflicts.length > 0) {
    lines.push(`## Potential Conflicts`);
    lines.push(``);
    lines.push(`These document pairs may have conflicting or duplicate information:`);
    lines.push(``);
    for (const conflict of report.conflicts) {
      lines.push(`- **${conflict.doc1Slug}** ↔ **${conflict.doc2Slug}**`);
      lines.push(`  - Similarity: ${(conflict.similarity * 100).toFixed(1)}%`);
      lines.push(`  - Type: ${conflict.conflictType || 'unknown'}`);
      lines.push(`  - Recommendation: ${conflict.recommendation}`);
    }
    lines.push(``);
  }

  return lines.filter(Boolean).join('\n');
}
