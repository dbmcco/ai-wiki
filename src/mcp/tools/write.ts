import { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as tenantService from '../../services/tenants.js';
import * as namespaceService from '../../services/namespaces.js';
import * as documentService from '../../services/documents.js';
import * as searchService from '../../services/search.js';

export const wikiWriteTool: Tool = {
  name: 'wiki_write',
  description: 'Create or update a document in the wiki. If the slug exists, it will be updated.',
  inputSchema: {
    type: 'object',
    properties: {
      tenant: {
        type: 'string',
        description: 'The tenant slug (e.g., "personal", "dev-learnings")',
      },
      namespace: {
        type: 'string',
        description: 'The namespace slug (e.g., "recipes", "architecture")',
      },
      slug: {
        type: 'string',
        description: 'The document slug (lowercase, hyphens allowed)',
      },
      title: {
        type: 'string',
        description: 'The document title',
      },
      content: {
        type: 'string',
        description: 'The document content (markdown supported)',
      },
      metadata: {
        type: 'object',
        description: 'Optional metadata as key-value pairs',
      },
      sourceType: {
        type: 'string',
        description: 'Source type (e.g., "conversation", "transcript", "research")',
      },
      sourceRef: {
        type: 'string',
        description: 'Reference to the original source',
      },
    },
    required: ['tenant', 'namespace', 'slug', 'title', 'content'],
  },
};

interface WriteArgs {
  tenant: string;
  namespace: string;
  slug: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  sourceType?: string;
  sourceRef?: string;
}

export async function handleWikiWrite(args: unknown) {
  const {
    tenant: tenantSlug,
    namespace: namespaceSlug,
    slug,
    title,
    content,
    metadata,
    sourceType,
    sourceRef,
  } = args as WriteArgs;

  const tenant = await tenantService.getTenantBySlug(tenantSlug);
  if (!tenant) {
    return {
      content: [{ type: 'text' as const, text: `Tenant "${tenantSlug}" not found` }],
      isError: true,
    };
  }

  const namespace = await namespaceService.getNamespaceBySlug(tenant.id, namespaceSlug);
  if (!namespace) {
    return {
      content: [{ type: 'text' as const, text: `Namespace "${namespaceSlug}" not found` }],
      isError: true,
    };
  }

  // Check if document exists
  const existing = await documentService.getDocumentBySlug(tenant.id, slug, namespace.id);

  // Generate embedding
  let embedding: number[] | undefined;
  try {
    const text = searchService.prepareTextForEmbedding(title, content, metadata);
    const result = await searchService.generateEmbedding(text);
    embedding = result.embedding;
  } catch (error) {
    console.warn('Failed to generate embedding:', error);
  }

  if (existing) {
    // Update existing document
    const updated = await documentService.updateDocument(existing.id, {
      title,
      content,
      contentEmbedding: embedding,
      metadata,
      changedBy: 'mcp-agent',
      changeReason: 'Updated via wiki_write tool',
    });

    return {
      content: [{
        type: 'text' as const,
        text: `Updated document "${updated?.title}" (${slug})`,
      }],
    };
  } else {
    // Create new document
    const document = await documentService.createDocument({
      tenantId: tenant.id,
      namespaceId: namespace.id,
      slug,
      title,
      content,
      contentEmbedding: embedding,
      metadata,
      createdBy: 'mcp-agent',
      sourceType,
      sourceRef,
    });

    return {
      content: [{
        type: 'text' as const,
        text: `Created document "${document.title}" (${slug})`,
      }],
    };
  }
}
