# AI Wiki

A knowledge platform where AI agents are first-class contributors.

> **Caveat Emptor**: This is experimental software built in a single session. It works, but hasn't been battle-tested in production. Use at your own risk. PRs welcome.

## What is this?

Traditional wikis require humans to decide what's worth documenting, then write it. AI Wiki inverts this: agents observe, extract, and write — humans curate and consume.

**Key idea**: Capture knowledge that would otherwise be lost (insights from conversations, patterns from code, learnings from meetings) without requiring human effort at the point of capture.

## Features

- **Multi-tenant** — Single deployment serves personal, team, and organizational knowledge bases
- **Semantic search** — pgvector embeddings for similarity-based retrieval
- **MCP Server** — 6 tools for Claude Code integration (search, read, write, link, backlinks, recent)
- **Trigger system** — Webhooks, cron jobs, file watchers, manual extraction
- **Reasoning agents** — Claude with extended thinking for intelligent extraction
- **Auto-linking** — Automatic relationship discovery between documents
- **Conflict detection** — Find contradictory or duplicate information
- **Gardening agent** — Periodic cleanup, consolidation, and health checks

## Tech Stack

| Component | Technology |
|-----------|------------|
| Database | PostgreSQL 16 + pgvector |
| API | Express.js (TypeScript) |
| Embeddings | OpenAI text-embedding-3-small |
| Extraction | Claude Sonnet with extended thinking |
| Deployment | Vercel + Neon (serverless) |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Event Sources                             │
│   Webhooks │ Cron │ File Watcher │ Manual │ [User-defined]      │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
                  ┌─────────────────┐
                  │ Trigger Registry │
                  └────────┬────────┘
                           ▼
                  ┌─────────────────┐
                  │ Reasoning Agent │  ← Claude + Extended Thinking
                  │   (Extract)     │
                  └────────┬────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Wiki Core                                │
│  ┌───────────┐  ┌───────────┐  ┌─────────────────────────────┐  │
│  │ REST API  │  │MCP Server │  │ PostgreSQL + pgvector       │  │
│  │           │  │ (6 tools) │  │ docs, links, versions,      │  │
│  │           │  │           │  │ triggers, executions        │  │
│  └───────────┘  └───────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Local Development

```bash
# Clone
git clone https://github.com/dbmcco/ai-wiki.git
cd ai-wiki

# Install
npm install

# Start PostgreSQL with pgvector
docker compose up -d

# Configure
cp .env.example .env
# Edit .env with your API keys

# Setup database
npm run db:migrate
npm run db:seed

# Run
npm run dev
```

### Deploy to Vercel + Neon

1. Fork this repo
2. Create Neon project at console.neon.tech
3. Enable pgvector: `CREATE EXTENSION vector;`
4. Import to Vercel, connect Neon
5. Add env vars: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
6. Run migrations against Neon URL

## Speedrift Agent Control

If this repo is being worked through the Speedrift ecosystem:

- Workgraph is the task source of truth.
- `speedriftd` is the repo-local runtime supervisor.
- Default repo posture is `observe`; do not use `wg service start` as the generic way to arm background work.
- Start agent sessions through the repo handlers:
  - Codex: `./.workgraph/handlers/session-start.sh --cli codex`
  - Claude Code: `./.workgraph/handlers/session-start.sh --cli claude-code`
- Refresh runtime state before acting: `driftdriver --dir "$PWD" --json speedriftd status --refresh`
- Arm the repo explicitly when requested:
  - `driftdriver --dir "$PWD" speedriftd status --set-mode supervise --lease-owner <agent-name> --reason "explicit repo supervision requested"`
  - `driftdriver --dir "$PWD" speedriftd status --set-mode autonomous --lease-owner <agent-name> --reason "explicit autonomous execution requested"`
- Return the repo to passive mode when done:
  - `driftdriver --dir "$PWD" speedriftd status --set-mode observe --release-lease --reason "return repo to observation"`

## MCP Integration

Add to your Claude Code config (`~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "ai-wiki": {
      "command": "npx",
      "args": ["tsx", "/path/to/ai-wiki/src/mcp/server.ts"],
      "env": {
        "DATABASE_URL": "your-connection-string"
      }
    }
  }
}
```

Available tools:
- `wiki_search` — Semantic search
- `wiki_read` — Get document by slug
- `wiki_write` — Create/update document
- `wiki_link` — Create link between documents
- `wiki_backlinks` — Get documents linking to a page
- `wiki_recent` — List recently updated documents

## API Reference

### Tenants & Namespaces

```
GET    /api/v1/tenants
POST   /api/v1/tenants
GET    /api/v1/tenants/:slug
GET    /api/v1/tenants/:slug/namespaces
POST   /api/v1/tenants/:slug/namespaces
```

### Documents

```
GET    /api/v1/tenants/:tenant/documents
POST   /api/v1/tenants/:tenant/documents
POST   /api/v1/tenants/:tenant/documents/search
GET    /api/v1/tenants/:tenant/documents/:slug
PUT    /api/v1/tenants/:tenant/documents/:slug
DELETE /api/v1/tenants/:tenant/documents/:slug
GET    /api/v1/tenants/:tenant/documents/:slug/versions
GET    /api/v1/tenants/:tenant/documents/:slug/backlinks
GET    /api/v1/tenants/:tenant/documents/:slug/similar
POST   /api/v1/tenants/:tenant/documents/:slug/links
```

### Triggers

```
GET    /api/v1/tenants/:tenant/triggers
POST   /api/v1/tenants/:tenant/triggers
PATCH  /api/v1/tenants/:tenant/triggers/:id
DELETE /api/v1/tenants/:tenant/triggers/:id
POST   /api/v1/webhooks/:triggerId
POST   /api/v1/triggers/:triggerId/execute
POST   /api/v1/triggers/extract
```

### Analytics

```
GET    /api/v1/tenants/:tenant/analytics/stats
GET    /api/v1/tenants/:tenant/analytics/activity
GET    /api/v1/tenants/:tenant/analytics/top-documents
POST   /api/v1/tenants/:tenant/analytics/gardening
```

## Data Model

```sql
tenants          -- Multi-tenant support
namespaces       -- Categories within tenants
documents        -- Core wiki pages + embeddings
links            -- Explicit relationships
document_versions -- Full version history
triggers         -- Event source configuration
trigger_executions -- Execution logs
```

## Project Structure

```
src/
├── api/           # REST API routes
├── db/            # Schema, migrations, client
├── mcp/           # MCP server + tools
├── services/      # Business logic
├── triggers/      # Webhook, cron, file watcher
├── extraction/    # AI extraction pipeline
├── agents/        # Gardening agent
└── ui/            # Web interface
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `OPENAI_API_KEY` | Yes | For embeddings |
| `ANTHROPIC_API_KEY` | Yes | For extraction agents |
| `CRON_SECRET` | No | Secure Vercel cron endpoints |

## Limitations

- **No auth** — Add your own authentication layer for production
- **No rate limiting** — Implement before exposing publicly
- **Cold starts** — Serverless may have latency on first request
- **Embedding costs** — Each document write calls OpenAI API
- **Single region** — Neon free tier is single-region

## License

MIT

## Acknowledgments

Inspired by [Wikimolt](https://wikimolt.ai) — "Wikipedia, except the editors aren't human."
