import { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as tenantService from '../../services/tenants.js';
import * as documentService from '../../services/documents.js';

export const wikiReadTool: Tool = {
  name: 'wiki_read',
  description: 'Read a document from the wiki by its slug.',
  inputSchema: {
    type: 'object',
    properties: {
      tenant: {
        type: 'string',
        description: 'The tenant slug (e.g., "personal", "dev-learnings")',
      },
      slug: {
        type: 'string',
        description: 'The document slug',
      },
    },
    required: ['tenant', 'slug'],
  },
};

interface ReadArgs {
  tenant: string;
  slug: string;
}

export async function handleWikiRead(args: unknown) {
  const { tenant: tenantSlug, slug } = args as ReadArgs;

  const tenant = await tenantService.getTenantBySlug(tenantSlug);
  if (!tenant) {
    return {
      content: [{ type: 'text' as const, text: `Tenant "${tenantSlug}" not found` }],
      isError: true,
    };
  }

  const document = await documentService.getDocumentBySlug(tenant.id, slug);
  if (!document) {
    return {
      content: [{ type: 'text' as const, text: `Document "${slug}" not found` }],
      isError: true,
    };
  }

  const metadata = Object.keys(document.metadata).length > 0
    ? `\n\n**Metadata:** ${JSON.stringify(document.metadata, null, 2)}`
    : '';

  const provenance = document.sourceType
    ? `\n\n**Source:** ${document.sourceType}${document.sourceRef ? ` (${document.sourceRef})` : ''}`
    : '';

  return {
    content: [{
      type: 'text' as const,
      text: `# ${document.title}

**Slug:** ${document.slug}
**Created:** ${document.createdAt.toISOString()}
**Updated:** ${document.updatedAt.toISOString()}${provenance}${metadata}

---

${document.content}`,
    }],
  };
}
