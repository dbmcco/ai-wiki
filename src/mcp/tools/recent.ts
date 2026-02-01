import { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as tenantService from '../../services/tenants.js';
import * as namespaceService from '../../services/namespaces.js';
import * as documentService from '../../services/documents.js';

export const wikiRecentTool: Tool = {
  name: 'wiki_recent',
  description: 'List recently updated documents in the wiki.',
  inputSchema: {
    type: 'object',
    properties: {
      tenant: {
        type: 'string',
        description: 'The tenant slug',
      },
      namespace: {
        type: 'string',
        description: 'Optional namespace to filter by',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (default: 20)',
      },
    },
    required: ['tenant'],
  },
};

interface RecentArgs {
  tenant: string;
  namespace?: string;
  limit?: number;
}

export async function handleWikiRecent(args: unknown) {
  const { tenant: tenantSlug, namespace: namespaceSlug, limit = 20 } = args as RecentArgs;

  const tenant = await tenantService.getTenantBySlug(tenantSlug);
  if (!tenant) {
    return {
      content: [{ type: 'text' as const, text: `Tenant "${tenantSlug}" not found` }],
      isError: true,
    };
  }

  let namespaceId: string | undefined;
  if (namespaceSlug) {
    const namespace = await namespaceService.getNamespaceBySlug(tenant.id, namespaceSlug);
    if (!namespace) {
      return {
        content: [{ type: 'text' as const, text: `Namespace "${namespaceSlug}" not found` }],
        isError: true,
      };
    }
    namespaceId = namespace.id;
  }

  const documents = await documentService.listDocuments({
    tenantId: tenant.id,
    namespaceId,
    limit,
    orderBy: 'updated_at',
    orderDir: 'desc',
  });

  if (documents.length === 0) {
    return {
      content: [{ type: 'text' as const, text: 'No documents found.' }],
    };
  }

  const formatted = documents.map((doc, i) => {
    const preview = doc.content.substring(0, 100).replace(/\n/g, ' ');
    return `${i + 1}. **${doc.title}** (${doc.slug})
   Updated: ${doc.updatedAt.toISOString()}
   ${preview}...`;
  }).join('\n\n');

  return {
    content: [{
      type: 'text' as const,
      text: `Recent documents:\n\n${formatted}`,
    }],
  };
}
