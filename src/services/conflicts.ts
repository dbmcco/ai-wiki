import { query } from '../db/client.js';
import { runSimpleExtraction } from '../extraction/agents.js';
import type { Document } from '../types.js';

export interface ConflictCandidate {
  doc1: {
    id: string;
    slug: string;
    title: string;
    content: string;
  };
  doc2: {
    id: string;
    slug: string;
    title: string;
    content: string;
  };
  similarity: number;
}

export interface ConflictAnalysis {
  hasConflict: boolean;
  conflictType?: 'contradiction' | 'duplication' | 'outdated' | 'partial_overlap';
  description: string;
  recommendation: 'merge' | 'update' | 'link' | 'archive' | 'none';
  details?: string;
}

export interface ConflictReport {
  candidate: ConflictCandidate;
  analysis: ConflictAnalysis;
}

// Find documents that might have conflicting information
export async function findConflictCandidates(
  tenantId: string,
  namespaceId?: string,
  similarityThreshold = 0.85
): Promise<ConflictCandidate[]> {
  const result = await query<{
    id1: string;
    slug1: string;
    title1: string;
    content1: string;
    id2: string;
    slug2: string;
    title2: string;
    content2: string;
    similarity: number;
  }>(
    `SELECT
       d1.id as id1, d1.slug as slug1, d1.title as title1, d1.content as content1,
       d2.id as id2, d2.slug as slug2, d2.title as title2, d2.content as content2,
       1 - (d1.content_embedding <=> d2.content_embedding) AS similarity
     FROM documents d1
     JOIN documents d2 ON d2.tenant_id = d1.tenant_id
                       AND d2.id > d1.id  -- Avoid duplicates
                       AND d2.content_embedding IS NOT NULL
     WHERE d1.tenant_id = $1
       AND ($2::uuid IS NULL OR d1.namespace_id = $2)
       AND ($2::uuid IS NULL OR d2.namespace_id = $2)
       AND d1.content_embedding IS NOT NULL
       AND d1.is_archived = FALSE
       AND d2.is_archived = FALSE
       AND 1 - (d1.content_embedding <=> d2.content_embedding) >= $3
     ORDER BY similarity DESC
     LIMIT 50`,
    [tenantId, namespaceId ?? null, similarityThreshold]
  );

  return result.rows.map((row) => ({
    doc1: {
      id: row.id1,
      slug: row.slug1,
      title: row.title1,
      content: row.content1,
    },
    doc2: {
      id: row.id2,
      slug: row.slug2,
      title: row.title2,
      content: row.content2,
    },
    similarity: row.similarity,
  }));
}

// Analyze a specific conflict candidate using AI
export async function analyzeConflict(
  candidate: ConflictCandidate
): Promise<ConflictAnalysis> {
  const prompt = `Analyze these two wiki documents for potential conflicts or redundancy.

## Document 1: ${candidate.doc1.title}
${candidate.doc1.content.substring(0, 2000)}

## Document 2: ${candidate.doc2.title}
${candidate.doc2.content.substring(0, 2000)}

## Analysis Required
Determine if these documents have:
1. Contradictory information (different facts about the same topic)
2. Duplication (essentially the same content)
3. Outdated information (one supersedes the other)
4. Partial overlap (some shared content but also unique content)
5. No conflict (just similar topics)

Respond in JSON format:
{
  "hasConflict": true/false,
  "conflictType": "contradiction" | "duplication" | "outdated" | "partial_overlap" | null,
  "description": "Brief description of the conflict or lack thereof",
  "recommendation": "merge" | "update" | "link" | "archive" | "none",
  "details": "Specific details about what should be done"
}`;

  try {
    const response = await runSimpleExtraction('', prompt);

    // Parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as ConflictAnalysis;
      return parsed;
    }
  } catch (error) {
    console.error('Error analyzing conflict:', error);
  }

  // Default response if analysis fails
  return {
    hasConflict: false,
    description: 'Unable to analyze conflict',
    recommendation: 'none',
  };
}

// Run full conflict detection for a tenant
export async function detectConflicts(
  tenantId: string,
  namespaceId?: string,
  options?: {
    similarityThreshold?: number;
    analyzeWithAI?: boolean;
    maxCandidates?: number;
  }
): Promise<ConflictReport[]> {
  const {
    similarityThreshold = 0.85,
    analyzeWithAI = true,
    maxCandidates = 20,
  } = options ?? {};

  const candidates = await findConflictCandidates(
    tenantId,
    namespaceId,
    similarityThreshold
  );

  const reports: ConflictReport[] = [];

  for (const candidate of candidates.slice(0, maxCandidates)) {
    let analysis: ConflictAnalysis;

    if (analyzeWithAI) {
      analysis = await analyzeConflict(candidate);
    } else {
      // Simple heuristic-based analysis
      analysis = {
        hasConflict: candidate.similarity > 0.9,
        conflictType: candidate.similarity > 0.95 ? 'duplication' : 'partial_overlap',
        description: `Documents have ${(candidate.similarity * 100).toFixed(1)}% similarity`,
        recommendation: candidate.similarity > 0.95 ? 'merge' : 'link',
      };
    }

    reports.push({ candidate, analysis });
  }

  return reports;
}

// Find documents that might be outdated based on age and lack of updates
export async function findPotentiallyOutdated(
  tenantId: string,
  daysThreshold = 180
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
    `SELECT * FROM documents
     WHERE tenant_id = $1
       AND is_archived = FALSE
       AND updated_at < NOW() - INTERVAL '${daysThreshold} days'
     ORDER BY updated_at ASC
     LIMIT 50`,
    [tenantId]
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
