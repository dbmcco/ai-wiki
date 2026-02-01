import { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as tenantService from '../../services/tenants.js';
import * as documentService from '../../services/documents.js';
import * as linkService from '../../services/links.js';

export const wikiBacklinksTool: Tool = {
  name: 'wiki_backlinks',
  description: 'Get all documents that link to a specific document.',
  inputSchema: {
    type: 'object',
    properties: {
      tenant: {
        type: 'string',
        description: 'The tenant slug',
      },
      slug: {
        type: 'string',
        description: 'The document slug to find backlinks for',
      },
    },
    required: ['tenant', 'slug'],
  },
};

interface BacklinksArgs {
  tenant: string;
  slug: string;
}

export async function handleWikiBacklinks(args: unknown) {
  const { tenant: tenantSlug, slug } = args as BacklinksArgs;

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

  const backlinks = await linkService.getBacklinksWithDocuments(document.id);

  if (backlinks.length === 0) {
    return {
      content: [{ type: 'text' as const, text: `No documents link to "${document.title}"` }],
    };
  }

  const formatted = backlinks.map((bl, i) => {
    const contextStr = bl.context ? ` - "${bl.context}"` : '';
    return `${i + 1}. **${bl.documentTitle}** (${bl.documentSlug}) [${bl.linkType}]${contextStr}`;
  }).join('\n');

  return {
    content: [{
      type: 'text' as const,
      text: `${backlinks.length} document(s) link to "${document.title}":\n\n${formatted}`,
    }],
  };
}
