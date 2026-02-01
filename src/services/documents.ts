import { query, queryOne, withTransaction } from '../db/client.js';
import type { Document } from '../types.js';

// Database row type
interface DocumentRow {
  id: string;
  tenant_id: string;
  namespace_id: string | null;
  slug: string;
  title: string;
  content: string;
  content_embedding: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  source_type: string | null;
  source_ref: string | null;
  is_archived: boolean;
  created_at: Date;
  updated_at: Date;
}

function rowToDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    namespaceId: row.namespace_id ?? undefined,
    slug: row.slug,
    title: row.title,
    content: row.content,
    contentEmbedding: row.content_embedding
      ? JSON.parse(row.content_embedding)
      : undefined,
    metadata: row.metadata,
    createdBy: row.created_by ?? undefined,
    sourceType: row.source_type ?? undefined,
    sourceRef: row.source_ref ?? undefined,
    isArchived: row.is_archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateDocumentInput {
  tenantId: string;
  namespaceId?: string;
  slug: string;
  title: string;
  content: string;
  contentEmbedding?: number[];
  metadata?: Record<string, unknown>;
  createdBy?: string;
  sourceType?: string;
  sourceRef?: string;
}

export interface UpdateDocumentInput {
  title?: string;
  content?: string;
  contentEmbedding?: number[];
  metadata?: Record<string, unknown>;
  changedBy?: string;
  changeReason?: string;
}

export interface ListDocumentsOptions {
  tenantId: string;
  namespaceId?: string;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
  orderBy?: 'created_at' | 'updated_at' | 'title';
  orderDir?: 'asc' | 'desc';
}

export async function createDocument(input: CreateDocumentInput): Promise<Document> {
  const embeddingValue = input.contentEmbedding
    ? `[${input.contentEmbedding.join(',')}]`
    : null;

  const result = await queryOne<DocumentRow>(
    `INSERT INTO documents (
      tenant_id, namespace_id, slug, title, content, content_embedding,
      metadata, created_by, source_type, source_ref
    ) VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8, $9, $10)
    RETURNING *`,
    [
      input.tenantId,
      input.namespaceId ?? null,
      input.slug,
      input.title,
      input.content,
      embeddingValue,
      JSON.stringify(input.metadata ?? {}),
      input.createdBy ?? null,
      input.sourceType ?? null,
      input.sourceRef ?? null,
    ]
  );

  if (!result) {
    throw new Error('Failed to create document');
  }

  return rowToDocument(result);
}

export async function getDocumentById(id: string): Promise<Document | null> {
  const result = await queryOne<DocumentRow>(
    'SELECT * FROM documents WHERE id = $1',
    [id]
  );
  return result ? rowToDocument(result) : null;
}

export async function getDocumentBySlug(
  tenantId: string,
  slug: string,
  namespaceId?: string
): Promise<Document | null> {
  const result = await queryOne<DocumentRow>(
    `SELECT * FROM documents
     WHERE tenant_id = $1 AND slug = $2
     AND ($3::uuid IS NULL OR namespace_id = $3)`,
    [tenantId, slug, namespaceId ?? null]
  );
  return result ? rowToDocument(result) : null;
}

export async function updateDocument(
  id: string,
  input: UpdateDocumentInput
): Promise<Document | null> {
  return withTransaction(async (client) => {
    // Get current document for versioning
    const currentResult = await client.query<DocumentRow>(
      'SELECT * FROM documents WHERE id = $1 FOR UPDATE',
      [id]
    );
    const current = currentResult.rows[0];
    if (!current) return null;

    // Get latest version number
    const versionResult = await client.query<{ max_version: number | null }>(
      'SELECT MAX(version_number) as max_version FROM document_versions WHERE document_id = $1',
      [id]
    );
    const nextVersion = (versionResult.rows[0]?.max_version ?? 0) + 1;

    // Create version record
    await client.query(
      `INSERT INTO document_versions (
        document_id, version_number, title, content, metadata, changed_by, change_reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        nextVersion,
        current.title,
        current.content,
        current.metadata,
        input.changedBy ?? null,
        input.changeReason ?? null,
      ]
    );

    // Build update query dynamically
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(input.title);
    }
    if (input.content !== undefined) {
      updates.push(`content = $${paramIndex++}`);
      values.push(input.content);
    }
    if (input.contentEmbedding !== undefined) {
      updates.push(`content_embedding = $${paramIndex++}::vector`);
      values.push(`[${input.contentEmbedding.join(',')}]`);
    }
    if (input.metadata !== undefined) {
      updates.push(`metadata = $${paramIndex++}`);
      values.push(JSON.stringify(input.metadata));
    }

    if (updates.length === 0) {
      return rowToDocument(current);
    }

    values.push(id);
    const updateResult = await client.query<DocumentRow>(
      `UPDATE documents SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    const updated = updateResult.rows[0];
    return updated ? rowToDocument(updated) : null;
  });
}

export async function archiveDocument(id: string): Promise<boolean> {
  const result = await query(
    'UPDATE documents SET is_archived = TRUE WHERE id = $1',
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function unarchiveDocument(id: string): Promise<boolean> {
  const result = await query(
    'UPDATE documents SET is_archived = FALSE WHERE id = $1',
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteDocument(id: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM documents WHERE id = $1',
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listDocuments(options: ListDocumentsOptions): Promise<Document[]> {
  const {
    tenantId,
    namespaceId,
    includeArchived = false,
    limit = 50,
    offset = 0,
    orderBy = 'updated_at',
    orderDir = 'desc',
  } = options;

  const validOrderBy = ['created_at', 'updated_at', 'title'].includes(orderBy)
    ? orderBy
    : 'updated_at';
  const validOrderDir = orderDir === 'asc' ? 'ASC' : 'DESC';

  const result = await query<DocumentRow>(
    `SELECT * FROM documents
     WHERE tenant_id = $1
     AND ($2::uuid IS NULL OR namespace_id = $2)
     AND ($3 OR is_archived = FALSE)
     ORDER BY ${validOrderBy} ${validOrderDir}
     LIMIT $4 OFFSET $5`,
    [tenantId, namespaceId ?? null, includeArchived, limit, offset]
  );

  return result.rows.map(rowToDocument);
}

export async function countDocuments(
  tenantId: string,
  namespaceId?: string,
  includeArchived = false
): Promise<number> {
  const result = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM documents
     WHERE tenant_id = $1
     AND ($2::uuid IS NULL OR namespace_id = $2)
     AND ($3 OR is_archived = FALSE)`,
    [tenantId, namespaceId ?? null, includeArchived]
  );
  return parseInt(result?.count ?? '0', 10);
}
