import { Router, Request, Response } from 'express';
import * as documentService from '../services/documents.js';
import * as tenantService from '../services/tenants.js';
import * as namespaceService from '../services/namespaces.js';
import * as versionService from '../services/versions.js';
import * as linkService from '../services/links.js';
import * as searchService from '../services/search.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

// Validation schemas
const createDocumentSchema = z.object({
  slug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  content: z.string(),
  namespace: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  createdBy: z.string().optional(),
  sourceType: z.string().optional(),
  sourceRef: z.string().optional(),
});

const updateDocumentSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  changedBy: z.string().optional(),
  changeReason: z.string().optional(),
});

const searchSchema = z.object({
  query: z.string().min(1),
  namespace: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  minSimilarity: z.number().min(0).max(1).optional(),
});

const createLinkSchema = z.object({
  targetSlug: z.string().min(1),
  linkType: z.enum(['reference', 'contradicts', 'extends', 'supersedes', 'related']).optional(),
  context: z.string().optional(),
});

// Helper to get tenant from params
async function getTenant(req: Request, res: Response) {
  const tenant = await tenantService.getTenantBySlug(req.params['tenant']!);
  if (!tenant) {
    res.status(404).json({ error: 'Tenant not found' });
    return null;
  }
  return tenant;
}

// List documents
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;

    const namespaceSlug = req.query['namespace'] as string | undefined;
    let namespaceId: string | undefined;

    if (namespaceSlug) {
      const namespace = await namespaceService.getNamespaceBySlug(tenant.id, namespaceSlug);
      if (!namespace) {
        res.status(404).json({ error: 'Namespace not found' });
        return;
      }
      namespaceId = namespace.id;
    }

    const documents = await documentService.listDocuments({
      tenantId: tenant.id,
      namespaceId,
      limit: parseInt(req.query['limit'] as string) || 50,
      offset: parseInt(req.query['offset'] as string) || 0,
      orderBy: (req.query['orderBy'] as 'created_at' | 'updated_at' | 'title') || 'updated_at',
      orderDir: (req.query['orderDir'] as 'asc' | 'desc') || 'desc',
    });

    const count = await documentService.countDocuments(tenant.id, namespaceId);

    res.json({ documents, total: count });
  } catch (error) {
    console.error('Error listing documents:', error);
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

// Search documents
router.post('/search', async (req: Request, res: Response) => {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;

    const input = searchSchema.parse(req.body);

    let namespaceId: string | undefined;
    if (input.namespace) {
      const namespace = await namespaceService.getNamespaceBySlug(tenant.id, input.namespace);
      if (!namespace) {
        res.status(404).json({ error: 'Namespace not found' });
        return;
      }
      namespaceId = namespace.id;
    }

    const results = await searchService.semanticSearch({
      tenantId: tenant.id,
      query: input.query,
      namespaceId,
      limit: input.limit,
      minSimilarity: input.minSimilarity,
    });

    res.json({ results });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    console.error('Error searching documents:', error);
    res.status(500).json({ error: 'Failed to search documents' });
  }
});

// Create document
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;

    const input = createDocumentSchema.parse(req.body);

    let namespaceId: string | undefined;
    if (input.namespace) {
      const namespace = await namespaceService.getNamespaceBySlug(tenant.id, input.namespace);
      if (!namespace) {
        res.status(404).json({ error: 'Namespace not found' });
        return;
      }
      namespaceId = namespace.id;
    }

    // Generate embedding for content
    let embedding: number[] | undefined;
    try {
      const text = searchService.prepareTextForEmbedding(input.title, input.content, input.metadata);
      const result = await searchService.generateEmbedding(text);
      embedding = result.embedding;
    } catch (embeddingError) {
      console.warn('Failed to generate embedding:', embeddingError);
      // Continue without embedding
    }

    const document = await documentService.createDocument({
      tenantId: tenant.id,
      namespaceId,
      slug: input.slug,
      title: input.title,
      content: input.content,
      contentEmbedding: embedding,
      metadata: input.metadata,
      createdBy: input.createdBy,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef,
    });

    res.status(201).json(document);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    console.error('Error creating document:', error);
    res.status(500).json({ error: 'Failed to create document' });
  }
});

// Get document by slug
router.get('/:slug', async (req: Request, res: Response) => {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;

    const document = await documentService.getDocumentBySlug(tenant.id, req.params['slug']!);
    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    res.json(document);
  } catch (error) {
    console.error('Error getting document:', error);
    res.status(500).json({ error: 'Failed to get document' });
  }
});

// Update document
router.put('/:slug', async (req: Request, res: Response) => {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;

    const document = await documentService.getDocumentBySlug(tenant.id, req.params['slug']!);
    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const input = updateDocumentSchema.parse(req.body);

    // Re-generate embedding if content or title changed
    let embedding: number[] | undefined;
    if (input.content || input.title) {
      try {
        const newTitle = input.title ?? document.title;
        const newContent = input.content ?? document.content;
        const newMetadata = input.metadata ?? document.metadata;
        const text = searchService.prepareTextForEmbedding(newTitle, newContent, newMetadata);
        const result = await searchService.generateEmbedding(text);
        embedding = result.embedding;
      } catch (embeddingError) {
        console.warn('Failed to generate embedding:', embeddingError);
      }
    }

    const updated = await documentService.updateDocument(document.id, {
      ...input,
      contentEmbedding: embedding,
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    console.error('Error updating document:', error);
    res.status(500).json({ error: 'Failed to update document' });
  }
});

// Archive document
router.delete('/:slug', async (req: Request, res: Response) => {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;

    const document = await documentService.getDocumentBySlug(tenant.id, req.params['slug']!);
    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    await documentService.archiveDocument(document.id);
    res.status(204).send();
  } catch (error) {
    console.error('Error archiving document:', error);
    res.status(500).json({ error: 'Failed to archive document' });
  }
});

// Get document versions
router.get('/:slug/versions', async (req: Request, res: Response) => {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;

    const document = await documentService.getDocumentBySlug(tenant.id, req.params['slug']!);
    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const versions = await versionService.getVersionsByDocumentId(
      document.id,
      parseInt(req.query['limit'] as string) || 50,
      parseInt(req.query['offset'] as string) || 0
    );

    const count = await versionService.countVersions(document.id);

    res.json({ versions, total: count });
  } catch (error) {
    console.error('Error getting versions:', error);
    res.status(500).json({ error: 'Failed to get versions' });
  }
});

// Get document backlinks
router.get('/:slug/backlinks', async (req: Request, res: Response) => {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;

    const document = await documentService.getDocumentBySlug(tenant.id, req.params['slug']!);
    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const backlinks = await linkService.getBacklinksWithDocuments(document.id);

    res.json({ backlinks });
  } catch (error) {
    console.error('Error getting backlinks:', error);
    res.status(500).json({ error: 'Failed to get backlinks' });
  }
});

// Create link from document
router.post('/:slug/links', async (req: Request, res: Response) => {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;

    const sourceDoc = await documentService.getDocumentBySlug(tenant.id, req.params['slug']!);
    if (!sourceDoc) {
      res.status(404).json({ error: 'Source document not found' });
      return;
    }

    const input = createLinkSchema.parse(req.body);

    const targetDoc = await documentService.getDocumentBySlug(tenant.id, input.targetSlug);
    if (!targetDoc) {
      res.status(404).json({ error: 'Target document not found' });
      return;
    }

    const link = await linkService.createLink({
      sourceId: sourceDoc.id,
      targetId: targetDoc.id,
      linkType: input.linkType,
      context: input.context,
    });

    res.status(201).json(link);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    console.error('Error creating link:', error);
    res.status(500).json({ error: 'Failed to create link' });
  }
});

// Find similar documents
router.get('/:slug/similar', async (req: Request, res: Response) => {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;

    const document = await documentService.getDocumentBySlug(tenant.id, req.params['slug']!);
    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const similar = await searchService.findSimilarDocuments({
      documentId: document.id,
      tenantId: tenant.id,
      limit: parseInt(req.query['limit'] as string) || 10,
      minSimilarity: parseFloat(req.query['minSimilarity'] as string) || 0.7,
    });

    res.json({ similar });
  } catch (error) {
    console.error('Error finding similar documents:', error);
    res.status(500).json({ error: 'Failed to find similar documents' });
  }
});

export default router;
