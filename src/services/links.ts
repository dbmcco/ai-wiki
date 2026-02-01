import { query, queryOne } from '../db/client.js';
import type { Link, LinkType } from '../types.js';

interface LinkRow {
  id: string;
  source_id: string;
  target_id: string;
  link_type: LinkType;
  context: string | null;
  created_by: string | null;
  created_at: Date;
}

function rowToLink(row: LinkRow): Link {
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    linkType: row.link_type,
    context: row.context ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
  };
}

export interface CreateLinkInput {
  sourceId: string;
  targetId: string;
  linkType?: LinkType;
  context?: string;
  createdBy?: string;
}

export async function createLink(input: CreateLinkInput): Promise<Link> {
  const result = await queryOne<LinkRow>(
    `INSERT INTO links (source_id, target_id, link_type, context, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (source_id, target_id, link_type) DO UPDATE
     SET context = EXCLUDED.context, created_by = EXCLUDED.created_by
     RETURNING *`,
    [
      input.sourceId,
      input.targetId,
      input.linkType ?? 'reference',
      input.context ?? null,
      input.createdBy ?? null,
    ]
  );

  if (!result) {
    throw new Error('Failed to create link');
  }

  return rowToLink(result);
}

export async function getLink(
  sourceId: string,
  targetId: string,
  linkType: LinkType = 'reference'
): Promise<Link | null> {
  const result = await queryOne<LinkRow>(
    `SELECT * FROM links
     WHERE source_id = $1 AND target_id = $2 AND link_type = $3`,
    [sourceId, targetId, linkType]
  );
  return result ? rowToLink(result) : null;
}

export async function deleteLink(
  sourceId: string,
  targetId: string,
  linkType?: LinkType
): Promise<boolean> {
  let sql = 'DELETE FROM links WHERE source_id = $1 AND target_id = $2';
  const params: unknown[] = [sourceId, targetId];

  if (linkType) {
    sql += ' AND link_type = $3';
    params.push(linkType);
  }

  const result = await query(sql, params);
  return (result.rowCount ?? 0) > 0;
}

export async function getForwardLinks(documentId: string): Promise<Link[]> {
  const result = await query<LinkRow>(
    `SELECT * FROM links WHERE source_id = $1 ORDER BY created_at DESC`,
    [documentId]
  );
  return result.rows.map(rowToLink);
}

export async function getBacklinks(documentId: string): Promise<Link[]> {
  const result = await query<LinkRow>(
    `SELECT * FROM links WHERE target_id = $1 ORDER BY created_at DESC`,
    [documentId]
  );
  return result.rows.map(rowToLink);
}

export interface LinkWithDocument extends Link {
  documentTitle: string;
  documentSlug: string;
}

interface LinkWithDocRow extends LinkRow {
  document_title: string;
  document_slug: string;
}

export async function getBacklinksWithDocuments(
  documentId: string
): Promise<LinkWithDocument[]> {
  const result = await query<LinkWithDocRow>(
    `SELECT l.*, d.title as document_title, d.slug as document_slug
     FROM links l
     JOIN documents d ON d.id = l.source_id
     WHERE l.target_id = $1
     ORDER BY l.created_at DESC`,
    [documentId]
  );

  return result.rows.map((row) => ({
    ...rowToLink(row),
    documentTitle: row.document_title,
    documentSlug: row.document_slug,
  }));
}

export async function getForwardLinksWithDocuments(
  documentId: string
): Promise<LinkWithDocument[]> {
  const result = await query<LinkWithDocRow>(
    `SELECT l.*, d.title as document_title, d.slug as document_slug
     FROM links l
     JOIN documents d ON d.id = l.target_id
     WHERE l.source_id = $1
     ORDER BY l.created_at DESC`,
    [documentId]
  );

  return result.rows.map((row) => ({
    ...rowToLink(row),
    documentTitle: row.document_title,
    documentSlug: row.document_slug,
  }));
}

export async function countBacklinks(documentId: string): Promise<number> {
  const result = await queryOne<{ count: string }>(
    'SELECT COUNT(*) as count FROM links WHERE target_id = $1',
    [documentId]
  );
  return parseInt(result?.count ?? '0', 10);
}
