import { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as tenantService from '../../services/tenants.js';
import * as namespaceService from '../../services/namespaces.js';
import * as searchService from '../../services/search.js';

export const wikiSearchTool: Tool = {
  name: 'wiki_search',
  description: 'Search the wiki using semantic similarity. Returns documents matching the query.',
  inputSchema: {
    type: 'object',
    properties: {
      tenant: {
        type: 'string',
        description: 'The tenant slug (e.g., "personal", "dev-learnings")',
      },
      query: {
        type: 'string',
        description: 'The search query',
      },
      namespace: {
        type: 'string',
        description: 'Optional namespace to search within',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (default: 10)',
      },
    },
    required: ['tenant', 'query'],
  },
};

interface SearchArgs {
  tenant: string;
  query: string;
  namespace?: string;
  limit?: number;
}

export async function handleWikiSearch(args: unknown) {
  const { tenant: tenantSlug, query, namespace: namespaceSlug, limit = 10 } = args as SearchArgs;

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

  const results = await searchService.semanticSearch({
    tenantId: tenant.id,
    query,
    namespaceId,
    limit,
  });

  if (results.length === 0) {
    return {
      content: [{ type: 'text' as const, text: 'No documents found matching your query.' }],
    };
  }

  const formatted = results.map((r, i) => {
    return `${i + 1}. **${r.document.title}** (${r.document.slug})
   Similarity: ${(r.similarity * 100).toFixed(1)}%
   ${r.document.content.substring(0, 200)}...`;
  }).join('\n\n');

  return {
    content: [{ type: 'text' as const, text: `Found ${results.length} results:\n\n${formatted}` }],
  };
}
