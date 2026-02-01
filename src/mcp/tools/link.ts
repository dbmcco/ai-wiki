import { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as tenantService from '../../services/tenants.js';
import * as documentService from '../../services/documents.js';
import * as linkService from '../../services/links.js';
import type { LinkType } from '../../types.js';

export const wikiLinkTool: Tool = {
  name: 'wiki_link',
  description: 'Create a link between two documents in the wiki.',
  inputSchema: {
    type: 'object',
    properties: {
      tenant: {
        type: 'string',
        description: 'The tenant slug',
      },
      sourceSlug: {
        type: 'string',
        description: 'The source document slug (the document that contains the link)',
      },
      targetSlug: {
        type: 'string',
        description: 'The target document slug (the document being linked to)',
      },
      linkType: {
        type: 'string',
        enum: ['reference', 'extends', 'contradicts', 'supersedes', 'related'],
        description: 'The type of relationship (default: reference)',
      },
      context: {
        type: 'string',
        description: 'Optional context explaining why these documents are linked',
      },
    },
    required: ['tenant', 'sourceSlug', 'targetSlug'],
  },
};

interface LinkArgs {
  tenant: string;
  sourceSlug: string;
  targetSlug: string;
  linkType?: LinkType;
  context?: string;
}

export async function handleWikiLink(args: unknown) {
  const {
    tenant: tenantSlug,
    sourceSlug,
    targetSlug,
    linkType = 'reference',
    context,
  } = args as LinkArgs;

  const tenant = await tenantService.getTenantBySlug(tenantSlug);
  if (!tenant) {
    return {
      content: [{ type: 'text' as const, text: `Tenant "${tenantSlug}" not found` }],
      isError: true,
    };
  }

  const sourceDoc = await documentService.getDocumentBySlug(tenant.id, sourceSlug);
  if (!sourceDoc) {
    return {
      content: [{ type: 'text' as const, text: `Source document "${sourceSlug}" not found` }],
      isError: true,
    };
  }

  const targetDoc = await documentService.getDocumentBySlug(tenant.id, targetSlug);
  if (!targetDoc) {
    return {
      content: [{ type: 'text' as const, text: `Target document "${targetSlug}" not found` }],
      isError: true,
    };
  }

  const link = await linkService.createLink({
    sourceId: sourceDoc.id,
    targetId: targetDoc.id,
    linkType,
    context,
    createdBy: 'mcp-agent',
  });

  return {
    content: [{
      type: 'text' as const,
      text: `Created ${link.linkType} link from "${sourceDoc.title}" to "${targetDoc.title}"`,
    }],
  };
}
