import { query, queryOne } from '../db/client.js';
import type { Namespace } from '../types.js';

interface NamespaceRow {
  id: string;
  tenant_id: string;
  slug: string;
  name: string;
  description: string | null;
  schema_hint: Record<string, unknown> | null;
  created_at: Date;
}

function rowToNamespace(row: NamespaceRow): Namespace {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? undefined,
    schemaHint: row.schema_hint ?? undefined,
    createdAt: row.created_at,
  };
}

export interface CreateNamespaceInput {
  tenantId: string;
  slug: string;
  name: string;
  description?: string;
  schemaHint?: Record<string, unknown>;
}

export interface UpdateNamespaceInput {
  name?: string;
  description?: string;
  schemaHint?: Record<string, unknown>;
}

export async function createNamespace(input: CreateNamespaceInput): Promise<Namespace> {
  const result = await queryOne<NamespaceRow>(
    `INSERT INTO namespaces (tenant_id, slug, name, description, schema_hint)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      input.tenantId,
      input.slug,
      input.name,
      input.description ?? null,
      input.schemaHint ? JSON.stringify(input.schemaHint) : null,
    ]
  );

  if (!result) {
    throw new Error('Failed to create namespace');
  }

  return rowToNamespace(result);
}

export async function getNamespaceById(id: string): Promise<Namespace | null> {
  const result = await queryOne<NamespaceRow>(
    'SELECT * FROM namespaces WHERE id = $1',
    [id]
  );
  return result ? rowToNamespace(result) : null;
}

export async function getNamespaceBySlug(
  tenantId: string,
  slug: string
): Promise<Namespace | null> {
  const result = await queryOne<NamespaceRow>(
    'SELECT * FROM namespaces WHERE tenant_id = $1 AND slug = $2',
    [tenantId, slug]
  );
  return result ? rowToNamespace(result) : null;
}

export async function updateNamespace(
  id: string,
  input: UpdateNamespaceInput
): Promise<Namespace | null> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(input.name);
  }
  if (input.description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    values.push(input.description);
  }
  if (input.schemaHint !== undefined) {
    updates.push(`schema_hint = $${paramIndex++}`);
    values.push(JSON.stringify(input.schemaHint));
  }

  if (updates.length === 0) {
    return getNamespaceById(id);
  }

  values.push(id);
  const result = await queryOne<NamespaceRow>(
    `UPDATE namespaces SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  return result ? rowToNamespace(result) : null;
}

export async function deleteNamespace(id: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM namespaces WHERE id = $1',
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listNamespaces(tenantId: string): Promise<Namespace[]> {
  const result = await query<NamespaceRow>(
    'SELECT * FROM namespaces WHERE tenant_id = $1 ORDER BY name',
    [tenantId]
  );
  return result.rows.map(rowToNamespace);
}
