import { query, queryOne } from '../db/client.js';
import type { TriggerExecution } from '../types.js';

interface ExecutionRow {
  id: string;
  trigger_id: string;
  started_at: Date;
  completed_at: Date | null;
  status: 'running' | 'success' | 'failed';
  input_summary: string | null;
  documents_created: number;
  documents_updated: number;
  error_message: string | null;
  execution_log: Record<string, unknown> | null;
}

function rowToExecution(row: ExecutionRow): TriggerExecution {
  return {
    id: row.id,
    triggerId: row.trigger_id,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    status: row.status,
    inputSummary: row.input_summary ?? undefined,
    documentsCreated: row.documents_created,
    documentsUpdated: row.documents_updated,
    errorMessage: row.error_message ?? undefined,
    executionLog: row.execution_log ?? undefined,
  };
}

export interface CreateExecutionInput {
  triggerId: string;
  inputSummary?: string;
}

export async function createExecution(input: CreateExecutionInput): Promise<TriggerExecution> {
  const result = await queryOne<ExecutionRow>(
    `INSERT INTO trigger_executions (trigger_id, input_summary)
     VALUES ($1, $2)
     RETURNING *`,
    [input.triggerId, input.inputSummary ?? null]
  );

  if (!result) {
    throw new Error('Failed to create execution');
  }

  return rowToExecution(result);
}

export async function getExecutionById(id: string): Promise<TriggerExecution | null> {
  const result = await queryOne<ExecutionRow>(
    'SELECT * FROM trigger_executions WHERE id = $1',
    [id]
  );
  return result ? rowToExecution(result) : null;
}

export interface CompleteExecutionInput {
  status: 'success' | 'failed';
  documentsCreated?: number;
  documentsUpdated?: number;
  errorMessage?: string;
  executionLog?: Record<string, unknown>;
}

export async function completeExecution(
  id: string,
  input: CompleteExecutionInput
): Promise<TriggerExecution | null> {
  const result = await queryOne<ExecutionRow>(
    `UPDATE trigger_executions SET
      completed_at = NOW(),
      status = $2,
      documents_created = COALESCE($3, documents_created),
      documents_updated = COALESCE($4, documents_updated),
      error_message = $5,
      execution_log = $6
     WHERE id = $1
     RETURNING *`,
    [
      id,
      input.status,
      input.documentsCreated ?? 0,
      input.documentsUpdated ?? 0,
      input.errorMessage ?? null,
      input.executionLog ? JSON.stringify(input.executionLog) : null,
    ]
  );

  return result ? rowToExecution(result) : null;
}

export async function listExecutions(
  triggerId: string,
  limit = 50,
  offset = 0
): Promise<TriggerExecution[]> {
  const result = await query<ExecutionRow>(
    `SELECT * FROM trigger_executions
     WHERE trigger_id = $1
     ORDER BY started_at DESC
     LIMIT $2 OFFSET $3`,
    [triggerId, limit, offset]
  );
  return result.rows.map(rowToExecution);
}

export async function getRecentExecutions(
  limit = 50
): Promise<TriggerExecution[]> {
  const result = await query<ExecutionRow>(
    `SELECT * FROM trigger_executions
     ORDER BY started_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows.map(rowToExecution);
}

export async function getRunningExecutions(): Promise<TriggerExecution[]> {
  const result = await query<ExecutionRow>(
    `SELECT * FROM trigger_executions
     WHERE status = 'running'
     ORDER BY started_at DESC`
  );
  return result.rows.map(rowToExecution);
}

export async function countExecutions(
  triggerId: string,
  status?: 'running' | 'success' | 'failed'
): Promise<number> {
  let sql = 'SELECT COUNT(*) as count FROM trigger_executions WHERE trigger_id = $1';
  const params: unknown[] = [triggerId];

  if (status) {
    sql += ' AND status = $2';
    params.push(status);
  }

  const result = await queryOne<{ count: string }>(sql, params);
  return parseInt(result?.count ?? '0', 10);
}
