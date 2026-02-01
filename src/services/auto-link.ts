import { query } from '../db/client.js';
import * as linkService from './links.js';
import type { Document, LinkType } from '../types.js';

interface SimilarDocRow {
  id: string;
  title: string;
  slug: string;
  similarity: number;
}

export interface AutoLinkOptions {
  documentId: string;
  tenantId: string;
  namespaceId?: string;
  similarityThreshold?: number;
  maxLinks?: number;
  linkType?: LinkType;
}

export interface AutoLinkResult {
  linksCreated: number;
  links: {
    targetId: string;
    targetSlug: string;
    targetTitle: string;
    similarity: number;
  }[];
}

export async function autoLinkDocument(options: AutoLinkOptions): Promise<AutoLinkResult> {
  const {
    documentId,
    tenantId,
    namespaceId,
    similarityThreshold = 0.75,
    maxLinks = 5,
    linkType = 'related',
  } = options;

  // Find similar documents
  const result = await query<SimilarDocRow>(
    `SELECT d2.id, d2.title, d2.slug,
            1 - (d1.content_embedding <=> d2.content_embedding) AS similarity
     FROM documents d1
     JOIN documents d2 ON d2.tenant_id = d1.tenant_id
                       AND d2.id != d1.id
                       AND d2.content_embedding IS NOT NULL
                       AND d2.is_archived = FALSE
     WHERE d1.id = $1
       AND d1.content_embedding IS NOT NULL
       AND d2.tenant_id = $2
       AND ($3::uuid IS NULL OR d2.namespace_id = $3)
       AND 1 - (d1.content_embedding <=> d2.content_embedding) >= $4
     ORDER BY d1.content_embedding <=> d2.content_embedding
     LIMIT $5`,
    [documentId, tenantId, namespaceId ?? null, similarityThreshold, maxLinks]
  );

  const links: AutoLinkResult['links'] = [];

  for (const row of result.rows) {
    // Check if link already exists
    const existingLink = await linkService.getLink(documentId, row.id, linkType);
    if (existingLink) continue;

    // Create bidirectional links
    await linkService.createLink({
      sourceId: documentId,
      targetId: row.id,
      linkType,
      context: `Auto-linked (similarity: ${(row.similarity * 100).toFixed(1)}%)`,
      createdBy: 'auto-link',
    });

    links.push({
      targetId: row.id,
      targetSlug: row.slug,
      targetTitle: row.title,
      similarity: row.similarity,
    });
  }

  return {
    linksCreated: links.length,
    links,
  };
}

export interface BulkAutoLinkOptions {
  tenantId: string;
  namespaceId?: string;
  similarityThreshold?: number;
  maxLinksPerDoc?: number;
}

export interface BulkAutoLinkResult {
  documentsProcessed: number;
  totalLinksCreated: number;
}

export async function bulkAutoLink(options: BulkAutoLinkOptions): Promise<BulkAutoLinkResult> {
  const {
    tenantId,
    namespaceId,
    similarityThreshold = 0.75,
    maxLinksPerDoc = 3,
  } = options;

  // Get all documents with embeddings
  const docsResult = await query<{ id: string }>(
    `SELECT id FROM documents
     WHERE tenant_id = $1
       AND ($2::uuid IS NULL OR namespace_id = $2)
       AND content_embedding IS NOT NULL
       AND is_archived = FALSE`,
    [tenantId, namespaceId ?? null]
  );

  let totalLinksCreated = 0;

  for (const doc of docsResult.rows) {
    const result = await autoLinkDocument({
      documentId: doc.id,
      tenantId,
      namespaceId,
      similarityThreshold,
      maxLinks: maxLinksPerDoc,
    });
    totalLinksCreated += result.linksCreated;
  }

  return {
    documentsProcessed: docsResult.rows.length,
    totalLinksCreated,
  };
}

// Find orphaned documents (no incoming or outgoing links)
export async function findOrphanedDocuments(
  tenantId: string,
  namespaceId?: string
): Promise<Document[]> {
  const result = await query<{
    id: string;
    tenant_id: string;
    namespace_id: string | null;
    slug: string;
    title: string;
    content: string;
    metadata: Record<string, unknown>;
    created_by: string | null;
    source_type: string | null;
    source_ref: string | null;
    is_archived: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT d.* FROM documents d
     LEFT JOIN links l1 ON l1.source_id = d.id
     LEFT JOIN links l2 ON l2.target_id = d.id
     WHERE d.tenant_id = $1
       AND ($2::uuid IS NULL OR d.namespace_id = $2)
       AND d.is_archived = FALSE
       AND l1.id IS NULL
       AND l2.id IS NULL`,
    [tenantId, namespaceId ?? null]
  );

  return result.rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    namespaceId: row.namespace_id ?? undefined,
    slug: row.slug,
    title: row.title,
    content: row.content,
    metadata: row.metadata,
    createdBy: row.created_by ?? undefined,
    sourceType: row.source_type ?? undefined,
    sourceRef: row.source_ref ?? undefined,
    isArchived: row.is_archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
