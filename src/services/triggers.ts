import { query, queryOne } from '../db/client.js';
import type { Trigger, TriggerType, RoutingRules } from '../types.js';

interface TriggerRow {
  id: string;
  tenant_id: string | null;
  name: string;
  description: string | null;
  trigger_type: TriggerType;
  trigger_config: Record<string, unknown>;
  agent_model: string;
  agent_system_prompt: string | null;
  agent_extraction_template: string | null;
  target_namespace_id: string | null;
  routing_rules: RoutingRules | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

function rowToTrigger(row: TriggerRow): Trigger {
  return {
    id: row.id,
    tenantId: row.tenant_id ?? undefined,
    name: row.name,
    description: row.description ?? undefined,
    triggerType: row.trigger_type,
    triggerConfig: row.trigger_config,
    agentModel: row.agent_model,
    agentSystemPrompt: row.agent_system_prompt ?? undefined,
    agentExtractionTemplate: row.agent_extraction_template ?? undefined,
    targetNamespaceId: row.target_namespace_id ?? undefined,
    routingRules: row.routing_rules ?? undefined,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateTriggerInput {
  tenantId?: string;
  name: string;
  description?: string;
  triggerType: TriggerType;
  triggerConfig: Record<string, unknown>;
  agentModel?: string;
  agentSystemPrompt?: string;
  agentExtractionTemplate?: string;
  targetNamespaceId?: string;
  routingRules?: RoutingRules;
}

export interface UpdateTriggerInput {
  name?: string;
  description?: string;
  triggerConfig?: Record<string, unknown>;
  agentModel?: string;
  agentSystemPrompt?: string;
  agentExtractionTemplate?: string;
  targetNamespaceId?: string;
  routingRules?: RoutingRules;
  isActive?: boolean;
}

export async function createTrigger(input: CreateTriggerInput): Promise<Trigger> {
  const result = await queryOne<TriggerRow>(
    `INSERT INTO triggers (
      tenant_id, name, description, trigger_type, trigger_config,
      agent_model, agent_system_prompt, agent_extraction_template,
      target_namespace_id, routing_rules
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      input.tenantId ?? null,
      input.name,
      input.description ?? null,
      input.triggerType,
      JSON.stringify(input.triggerConfig),
      input.agentModel ?? 'claude-sonnet-4-20250514',
      input.agentSystemPrompt ?? null,
      input.agentExtractionTemplate ?? null,
      input.targetNamespaceId ?? null,
      input.routingRules ? JSON.stringify(input.routingRules) : null,
    ]
  );

  if (!result) {
    throw new Error('Failed to create trigger');
  }

  return rowToTrigger(result);
}

export async function getTriggerById(id: string): Promise<Trigger | null> {
  const result = await queryOne<TriggerRow>(
    'SELECT * FROM triggers WHERE id = $1',
    [id]
  );
  return result ? rowToTrigger(result) : null;
}

export async function updateTrigger(
  id: string,
  input: UpdateTriggerInput
): Promise<Trigger | null> {
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
  if (input.triggerConfig !== undefined) {
    updates.push(`trigger_config = $${paramIndex++}`);
    values.push(JSON.stringify(input.triggerConfig));
  }
  if (input.agentModel !== undefined) {
    updates.push(`agent_model = $${paramIndex++}`);
    values.push(input.agentModel);
  }
  if (input.agentSystemPrompt !== undefined) {
    updates.push(`agent_system_prompt = $${paramIndex++}`);
    values.push(input.agentSystemPrompt);
  }
  if (input.agentExtractionTemplate !== undefined) {
    updates.push(`agent_extraction_template = $${paramIndex++}`);
    values.push(input.agentExtractionTemplate);
  }
  if (input.targetNamespaceId !== undefined) {
    updates.push(`target_namespace_id = $${paramIndex++}`);
    values.push(input.targetNamespaceId);
  }
  if (input.routingRules !== undefined) {
    updates.push(`routing_rules = $${paramIndex++}`);
    values.push(JSON.stringify(input.routingRules));
  }
  if (input.isActive !== undefined) {
    updates.push(`is_active = $${paramIndex++}`);
    values.push(input.isActive);
  }

  if (updates.length === 0) {
    return getTriggerById(id);
  }

  values.push(id);
  const result = await queryOne<TriggerRow>(
    `UPDATE triggers SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  return result ? rowToTrigger(result) : null;
}

export async function deleteTrigger(id: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM triggers WHERE id = $1',
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listTriggers(tenantId?: string): Promise<Trigger[]> {
  let sql = 'SELECT * FROM triggers';
  const params: unknown[] = [];

  if (tenantId) {
    sql += ' WHERE tenant_id = $1';
    params.push(tenantId);
  }

  sql += ' ORDER BY created_at DESC';

  const result = await query<TriggerRow>(sql, params);
  return result.rows.map(rowToTrigger);
}

export async function listActiveTriggers(tenantId?: string): Promise<Trigger[]> {
  let sql = 'SELECT * FROM triggers WHERE is_active = TRUE';
  const params: unknown[] = [];

  if (tenantId) {
    sql += ' AND tenant_id = $1';
    params.push(tenantId);
  }

  sql += ' ORDER BY created_at DESC';

  const result = await query<TriggerRow>(sql, params);
  return result.rows.map(rowToTrigger);
}

export async function getActiveTriggersByType(
  triggerType: TriggerType,
  tenantId?: string
): Promise<Trigger[]> {
  let sql = 'SELECT * FROM triggers WHERE is_active = TRUE AND trigger_type = $1';
  const params: unknown[] = [triggerType];

  if (tenantId) {
    sql += ' AND tenant_id = $2';
    params.push(tenantId);
  }

  const result = await query<TriggerRow>(sql, params);
  return result.rows.map(rowToTrigger);
}
