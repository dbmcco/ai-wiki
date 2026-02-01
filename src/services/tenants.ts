import { query, queryOne } from '../db/client.js';
import type { Tenant, TenantSettings } from '../types.js';

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  settings: TenantSettings;
  created_at: Date;
}

function rowToTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    settings: row.settings,
    createdAt: row.created_at,
  };
}

export interface CreateTenantInput {
  slug: string;
  name: string;
  settings?: TenantSettings;
}

export interface UpdateTenantInput {
  name?: string;
  settings?: TenantSettings;
}

export async function createTenant(input: CreateTenantInput): Promise<Tenant> {
  const result = await queryOne<TenantRow>(
    `INSERT INTO tenants (slug, name, settings)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [input.slug, input.name, JSON.stringify(input.settings ?? {})]
  );

  if (!result) {
    throw new Error('Failed to create tenant');
  }

  return rowToTenant(result);
}

export async function getTenantById(id: string): Promise<Tenant | null> {
  const result = await queryOne<TenantRow>(
    'SELECT * FROM tenants WHERE id = $1',
    [id]
  );
  return result ? rowToTenant(result) : null;
}

export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const result = await queryOne<TenantRow>(
    'SELECT * FROM tenants WHERE slug = $1',
    [slug]
  );
  return result ? rowToTenant(result) : null;
}

export async function updateTenant(
  id: string,
  input: UpdateTenantInput
): Promise<Tenant | null> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(input.name);
  }
  if (input.settings !== undefined) {
    updates.push(`settings = $${paramIndex++}`);
    values.push(JSON.stringify(input.settings));
  }

  if (updates.length === 0) {
    return getTenantById(id);
  }

  values.push(id);
  const result = await queryOne<TenantRow>(
    `UPDATE tenants SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  return result ? rowToTenant(result) : null;
}

export async function deleteTenant(id: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM tenants WHERE id = $1',
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listTenants(): Promise<Tenant[]> {
  const result = await query<TenantRow>(
    'SELECT * FROM tenants ORDER BY name'
  );
  return result.rows.map(rowToTenant);
}
