import { query, queryOne } from '../db/client.js';
import type { DocumentVersion } from '../types.js';

interface VersionRow {
  id: string;
  document_id: string;
  version_number: number;
  title: string;
  content: string;
  metadata: Record<string, unknown> | null;
  changed_by: string | null;
  change_reason: string | null;
  created_at: Date;
}

function rowToVersion(row: VersionRow): DocumentVersion {
  return {
    id: row.id,
    documentId: row.document_id,
    versionNumber: row.version_number,
    title: row.title,
    content: row.content,
    metadata: row.metadata ?? {},
    changedBy: row.changed_by ?? undefined,
    changeReason: row.change_reason ?? undefined,
    createdAt: row.created_at,
  };
}

export async function getVersionsByDocumentId(
  documentId: string,
  limit = 50,
  offset = 0
): Promise<DocumentVersion[]> {
  const result = await query<VersionRow>(
    `SELECT * FROM document_versions
     WHERE document_id = $1
     ORDER BY version_number DESC
     LIMIT $2 OFFSET $3`,
    [documentId, limit, offset]
  );
  return result.rows.map(rowToVersion);
}

export async function getVersionByNumber(
  documentId: string,
  versionNumber: number
): Promise<DocumentVersion | null> {
  const result = await queryOne<VersionRow>(
    `SELECT * FROM document_versions
     WHERE document_id = $1 AND version_number = $2`,
    [documentId, versionNumber]
  );
  return result ? rowToVersion(result) : null;
}

export async function getLatestVersion(
  documentId: string
): Promise<DocumentVersion | null> {
  const result = await queryOne<VersionRow>(
    `SELECT * FROM document_versions
     WHERE document_id = $1
     ORDER BY version_number DESC
     LIMIT 1`,
    [documentId]
  );
  return result ? rowToVersion(result) : null;
}

export async function countVersions(documentId: string): Promise<number> {
  const result = await queryOne<{ count: string }>(
    'SELECT COUNT(*) as count FROM document_versions WHERE document_id = $1',
    [documentId]
  );
  return parseInt(result?.count ?? '0', 10);
}

export interface VersionDiff {
  versionNumber: number;
  changedBy?: string;
  changeReason?: string;
  createdAt: Date;
  titleChanged: boolean;
  contentChanged: boolean;
}

export async function getVersionDiffs(
  documentId: string,
  limit = 20
): Promise<VersionDiff[]> {
  const versions = await getVersionsByDocumentId(documentId, limit + 1);

  const diffs: VersionDiff[] = [];
  for (let i = 0; i < versions.length - 1; i++) {
    const current = versions[i];
    const previous = versions[i + 1];
    if (current && previous) {
      diffs.push({
        versionNumber: current.versionNumber,
        changedBy: current.changedBy,
        changeReason: current.changeReason,
        createdAt: current.createdAt,
        titleChanged: current.title !== previous.title,
        contentChanged: current.content !== previous.content,
      });
    }
  }

  return diffs;
}
