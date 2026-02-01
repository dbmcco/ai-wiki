import type { Trigger, Document } from '../types.js';
import * as documentService from '../services/documents.js';
import * as linkService from '../services/links.js';
import * as executionService from '../services/executions.js';
import * as searchService from '../services/search.js';
import { runExtractionAgent } from './agents.js';

export interface PipelineInput {
  trigger: Trigger;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface PipelineOutput {
  executionId: string;
  documentsCreated: Document[];
  documentsUpdated: Document[];
  linksCreated: number;
  success: boolean;
  error?: string;
}

export async function runPipeline(input: PipelineInput): Promise<PipelineOutput> {
  const { trigger, content, metadata } = input;

  // Create execution record
  const execution = await executionService.createExecution({
    triggerId: trigger.id,
    inputSummary: content.substring(0, 500),
  });

  const documentsCreated: Document[] = [];
  const documentsUpdated: Document[] = [];
  let linksCreated = 0;

  try {
    // Find relevant existing documents for context
    let relevantDocs: { document: Document; similarity: number }[] = [];
    if (trigger.tenantId) {
      try {
        relevantDocs = await searchService.semanticSearch({
          tenantId: trigger.tenantId,
          query: content.substring(0, 1000),
          namespaceId: trigger.targetNamespaceId,
          limit: 5,
          minSimilarity: 0.6,
        });
      } catch {
        // Continue without context if search fails
      }
    }

    // Run extraction agent
    const extractionResult = await runExtractionAgent({
      trigger,
      content,
      metadata,
      relevantDocuments: relevantDocs.map((r) => ({
        slug: r.document.slug,
        title: r.document.title,
        content: r.document.content.substring(0, 500),
      })),
    });

    // Process extracted documents
    for (const doc of extractionResult.documents) {
      // Generate embedding
      let embedding: number[] | undefined;
      try {
        const text = searchService.prepareTextForEmbedding(
          doc.title,
          doc.content,
          doc.metadata
        );
        const result = await searchService.generateEmbedding(text);
        embedding = result.embedding;
      } catch {
        // Continue without embedding
      }

      if (doc.action === 'create' && trigger.tenantId) {
        const created = await documentService.createDocument({
          tenantId: trigger.tenantId,
          namespaceId: trigger.targetNamespaceId,
          slug: doc.slug,
          title: doc.title,
          content: doc.content,
          contentEmbedding: embedding,
          metadata: doc.metadata,
          createdBy: `trigger:${trigger.name}`,
          sourceType: trigger.triggerType,
        });
        documentsCreated.push(created);

        // Create links if specified
        if (doc.links && trigger.tenantId) {
          for (const link of doc.links) {
            const targetDoc = await documentService.getDocumentBySlug(
              trigger.tenantId,
              link.targetSlug
            );
            if (targetDoc) {
              await linkService.createLink({
                sourceId: created.id,
                targetId: targetDoc.id,
                linkType: link.linkType,
                context: link.context,
                createdBy: `trigger:${trigger.name}`,
              });
              linksCreated++;
            }
          }
        }
      } else if (doc.action === 'update' && trigger.tenantId) {
        const existing = await documentService.getDocumentBySlug(
          trigger.tenantId,
          doc.slug
        );
        if (existing) {
          const updated = await documentService.updateDocument(existing.id, {
            title: doc.title,
            content: doc.content,
            contentEmbedding: embedding,
            metadata: doc.metadata,
            changedBy: `trigger:${trigger.name}`,
            changeReason: 'Updated by extraction pipeline',
          });
          if (updated) {
            documentsUpdated.push(updated);
          }
        }
      }
    }

    // Complete execution successfully
    await executionService.completeExecution(execution.id, {
      status: 'success',
      documentsCreated: documentsCreated.length,
      documentsUpdated: documentsUpdated.length,
      executionLog: {
        reasoning: extractionResult.reasoning,
        linksCreated,
      },
    });

    return {
      executionId: execution.id,
      documentsCreated,
      documentsUpdated,
      linksCreated,
      success: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await executionService.completeExecution(execution.id, {
      status: 'failed',
      errorMessage,
    });

    return {
      executionId: execution.id,
      documentsCreated,
      documentsUpdated,
      linksCreated,
      success: false,
      error: errorMessage,
    };
  }
}
