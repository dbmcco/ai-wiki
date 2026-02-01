#!/usr/bin/env node
import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { wikiSearchTool, handleWikiSearch } from './tools/search.js';
import { wikiReadTool, handleWikiRead } from './tools/read.js';
import { wikiWriteTool, handleWikiWrite } from './tools/write.js';
import { wikiLinkTool, handleWikiLink } from './tools/link.js';
import { wikiBacklinksTool, handleWikiBacklinks } from './tools/backlinks.js';
import { wikiRecentTool, handleWikiRecent } from './tools/recent.js';

const server = new Server(
  {
    name: 'ai-wiki',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    wikiSearchTool,
    wikiReadTool,
    wikiWriteTool,
    wikiLinkTool,
    wikiBacklinksTool,
    wikiRecentTool,
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'wiki_search':
        return await handleWikiSearch(args);
      case 'wiki_read':
        return await handleWikiRead(args);
      case 'wiki_write':
        return await handleWikiWrite(args);
      case 'wiki_link':
        return await handleWikiLink(args);
      case 'wiki_backlinks':
        return await handleWikiBacklinks(args);
      case 'wiki_recent':
        return await handleWikiRecent(args);
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('AI Wiki MCP server running');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
