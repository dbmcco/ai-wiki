import { Router, Request, Response } from 'express';
import * as tenantService from '../services/tenants.js';
import * as namespaceService from '../services/namespaces.js';
import { z } from 'zod';

const router = Router();

// Validation schemas
const createTenantSchema = z.object({
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  settings: z.object({
    defaultModel: z.string().optional(),
    autoLinkThreshold: z.number().min(0).max(1).optional(),
    requireSourceRef: z.boolean().optional(),
    allowedSourceTypes: z.array(z.string()).optional(),
  }).optional(),
});

const updateTenantSchema = z.object({
  name: z.string().min(1).optional(),
  settings: z.object({
    defaultModel: z.string().optional(),
    autoLinkThreshold: z.number().min(0).max(1).optional(),
    requireSourceRef: z.boolean().optional(),
    allowedSourceTypes: z.array(z.string()).optional(),
  }).optional(),
});

const createNamespaceSchema = z.object({
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().optional(),
  schemaHint: z.record(z.unknown()).optional(),
});

const updateNamespaceSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  schemaHint: z.record(z.unknown()).optional(),
});

// List tenants
router.get('/', async (_req: Request, res: Response) => {
  try {
    const tenants = await tenantService.listTenants();
    res.json({ tenants });
  } catch (error) {
    console.error('Error listing tenants:', error);
    res.status(500).json({ error: 'Failed to list tenants' });
  }
});

// Create tenant
router.post('/', async (req: Request, res: Response) => {
  try {
    const input = createTenantSchema.parse(req.body);
    const tenant = await tenantService.createTenant(input);
    res.status(201).json(tenant);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    console.error('Error creating tenant:', error);
    res.status(500).json({ error: 'Failed to create tenant' });
  }
});

// Get tenant by slug
router.get('/:slug', async (req: Request, res: Response) => {
  try {
    const tenant = await tenantService.getTenantBySlug(req.params['slug']!);
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }
    res.json(tenant);
  } catch (error) {
    console.error('Error getting tenant:', error);
    res.status(500).json({ error: 'Failed to get tenant' });
  }
});

// Update tenant
router.patch('/:slug', async (req: Request, res: Response) => {
  try {
    const tenant = await tenantService.getTenantBySlug(req.params['slug']!);
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const input = updateTenantSchema.parse(req.body);
    const updated = await tenantService.updateTenant(tenant.id, input);
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    console.error('Error updating tenant:', error);
    res.status(500).json({ error: 'Failed to update tenant' });
  }
});

// Delete tenant
router.delete('/:slug', async (req: Request, res: Response) => {
  try {
    const tenant = await tenantService.getTenantBySlug(req.params['slug']!);
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    await tenantService.deleteTenant(tenant.id);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting tenant:', error);
    res.status(500).json({ error: 'Failed to delete tenant' });
  }
});

// List namespaces for tenant
router.get('/:slug/namespaces', async (req: Request, res: Response) => {
  try {
    const tenant = await tenantService.getTenantBySlug(req.params['slug']!);
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const namespaces = await namespaceService.listNamespaces(tenant.id);
    res.json({ namespaces });
  } catch (error) {
    console.error('Error listing namespaces:', error);
    res.status(500).json({ error: 'Failed to list namespaces' });
  }
});

// Create namespace
router.post('/:slug/namespaces', async (req: Request, res: Response) => {
  try {
    const tenant = await tenantService.getTenantBySlug(req.params['slug']!);
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const input = createNamespaceSchema.parse(req.body);
    const namespace = await namespaceService.createNamespace({
      ...input,
      tenantId: tenant.id,
    });
    res.status(201).json(namespace);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    console.error('Error creating namespace:', error);
    res.status(500).json({ error: 'Failed to create namespace' });
  }
});

// Get namespace
router.get('/:slug/namespaces/:ns', async (req: Request, res: Response) => {
  try {
    const tenant = await tenantService.getTenantBySlug(req.params['slug']!);
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const namespace = await namespaceService.getNamespaceBySlug(tenant.id, req.params['ns']!);
    if (!namespace) {
      res.status(404).json({ error: 'Namespace not found' });
      return;
    }
    res.json(namespace);
  } catch (error) {
    console.error('Error getting namespace:', error);
    res.status(500).json({ error: 'Failed to get namespace' });
  }
});

// Update namespace
router.patch('/:slug/namespaces/:ns', async (req: Request, res: Response) => {
  try {
    const tenant = await tenantService.getTenantBySlug(req.params['slug']!);
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const namespace = await namespaceService.getNamespaceBySlug(tenant.id, req.params['ns']!);
    if (!namespace) {
      res.status(404).json({ error: 'Namespace not found' });
      return;
    }

    const input = updateNamespaceSchema.parse(req.body);
    const updated = await namespaceService.updateNamespace(namespace.id, input);
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    console.error('Error updating namespace:', error);
    res.status(500).json({ error: 'Failed to update namespace' });
  }
});

// Delete namespace
router.delete('/:slug/namespaces/:ns', async (req: Request, res: Response) => {
  try {
    const tenant = await tenantService.getTenantBySlug(req.params['slug']!);
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const namespace = await namespaceService.getNamespaceBySlug(tenant.id, req.params['ns']!);
    if (!namespace) {
      res.status(404).json({ error: 'Namespace not found' });
      return;
    }

    await namespaceService.deleteNamespace(namespace.id);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting namespace:', error);
    res.status(500).json({ error: 'Failed to delete namespace' });
  }
});

export default router;
