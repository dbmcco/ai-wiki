import { query } from '../db/client.js';
import { generateEmbedding, prepareTextForEmbedding } from './embeddings.js';
import type { Document } from '../types.js';

interface SearchResultRow {
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
  similarity: number;
}

export interface SearchResult {
  document: Document;
  similarity: number;
}

export interface SearchOptions {
  tenantId: string;
  query: string;
  namespaceId?: string;
  limit?: number;
  minSimilarity?: number;
  includeArchived?: boolean;
}

export async function semanticSearch(options: SearchOptions): Promise<SearchResult[]> {
  const {
    tenantId,
    query: searchQuery,
    namespaceId,
    limit = 20,
    minSimilarity = 0.5,
    includeArchived = false,
  } = options;

  // Generate embedding for the search query
  const { embedding } = await generateEmbedding(searchQuery);
  const embeddingStr = `[${embedding.join(',')}]`;

  const result = await query<SearchResultRow>(
    `SELECT *,
            1 - (content_embedding <=> $1::vector) AS similarity
     FROM documents
     WHERE tenant_id = $2
       AND ($3::uuid IS NULL OR namespace_id = $3)
       AND ($4 OR is_archived = FALSE)
       AND content_embedding IS NOT NULL
       AND 1 - (content_embedding <=> $1::vector) >= $5
     ORDER BY content_embedding <=> $1::vector
     LIMIT $6`,
    [embeddingStr, tenantId, namespaceId ?? null, includeArchived, minSimilarity, limit]
  );

  return result.rows.map((row) => ({
    document: {
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
    },
    similarity: row.similarity,
  }));
}

export interface HybridSearchOptions extends SearchOptions {
  keywordWeight?: number;
  semanticWeight?: number;
}

export async function hybridSearch(options: HybridSearchOptions): Promise<SearchResult[]> {
  const {
    tenantId,
    query: searchQuery,
    namespaceId,
    limit = 20,
    includeArchived = false,
    keywordWeight = 0.3,
    semanticWeight = 0.7,
  } = options;

  // Generate embedding for semantic search
  const { embedding } = await generateEmbedding(searchQuery);
  const embeddingStr = `[${embedding.join(',')}]`;

  // Combine semantic similarity with keyword matching
  const result = await query<SearchResultRow>(
    `WITH semantic AS (
       SELECT id,
              $6 * (1 - (content_embedding <=> $1::vector)) AS score
       FROM documents
       WHERE tenant_id = $2
         AND ($3::uuid IS NULL OR namespace_id = $3)
         AND ($4 OR is_archived = FALSE)
         AND content_embedding IS NOT NULL
     ),
     keyword AS (
       SELECT id,
              $7 * ts_rank_cd(
                to_tsvector('english', title || ' ' || content),
                plainto_tsquery('english', $5)
              ) AS score
       FROM documents
       WHERE tenant_id = $2
         AND ($3::uuid IS NULL OR namespace_id = $3)
         AND ($4 OR is_archived = FALSE)
         AND to_tsvector('english', title || ' ' || content) @@ plainto_tsquery('english', $5)
     ),
     combined AS (
       SELECT COALESCE(s.id, k.id) AS id,
              COALESCE(s.score, 0) + COALESCE(k.score, 0) AS total_score
       FROM semantic s
       FULL OUTER JOIN keyword k ON s.id = k.id
     )
     SELECT d.*,
            c.total_score AS similarity
     FROM combined c
     JOIN documents d ON d.id = c.id
     WHERE c.total_score > 0
     ORDER BY c.total_score DESC
     LIMIT $8`,
    [
      embeddingStr,
      tenantId,
      namespaceId ?? null,
      includeArchived,
      searchQuery,
      semanticWeight,
      keywordWeight,
      limit,
    ]
  );

  return result.rows.map((row) => ({
    document: {
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
    },
    similarity: row.similarity,
  }));
}

export interface FindSimilarOptions {
  documentId: string;
  tenantId: string;
  namespaceId?: string;
  limit?: number;
  minSimilarity?: number;
}

export async function findSimilarDocuments(
  options: FindSimilarOptions
): Promise<SearchResult[]> {
  const {
    documentId,
    tenantId,
    namespaceId,
    limit = 10,
    minSimilarity = 0.7,
  } = options;

  const result = await query<SearchResultRow>(
    `SELECT d2.*,
            1 - (d1.content_embedding <=> d2.content_embedding) AS similarity
     FROM documents d1
     JOIN documents d2 ON d2.tenant_id = d1.tenant_id
                       AND d2.id != d1.id
                       AND d2.content_embedding IS NOT NULL
     WHERE d1.id = $1
       AND d1.content_embedding IS NOT NULL
       AND d2.tenant_id = $2
       AND ($3::uuid IS NULL OR d2.namespace_id = $3)
       AND d2.is_archived = FALSE
       AND 1 - (d1.content_embedding <=> d2.content_embedding) >= $4
     ORDER BY d1.content_embedding <=> d2.content_embedding
     LIMIT $5`,
    [documentId, tenantId, namespaceId ?? null, minSimilarity, limit]
  );

  return result.rows.map((row) => ({
    document: {
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
    },
    similarity: row.similarity,
  }));
}

// Re-export for convenience
export { generateEmbedding, prepareTextForEmbedding };
