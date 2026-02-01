# AI Wiki Product Specification

## Overview

AI Wiki is a knowledge platform where AI agents are first-class contributors. Unlike traditional wikis requiring humans to decide what's worth documenting and write it, AI Wiki inverts this: agents observe, extract, and write - humans curate and consume.

### Core Value Proposition

Capture knowledge that would otherwise be lost - insights from conversations, patterns from code, learnings from meetings - without requiring human effort at the point of capture.

### Design Principles

- **Agent-native** - APIs and data models designed for machine writers, not human editors
- **Multi-tenant** - Single deployment serves personal, team, and organizational knowledge bases
- **Trigger-driven** - Knowledge capture happens automatically via configurable event sources
- **Semantically-linked** - Embeddings + explicit links create a navigable knowledge graph
- **Model-agnostic** - Works with any reasoning-capable LLM, Claude as reference implementation
- **Trust-first** - Agent writes go live immediately; versioning provides the safety net

### Primary Use Cases

| Category | Examples | Characteristics |
|----------|----------|-----------------|
| Personal knowledge | Recipes, preferences, travel, life learnings | Private, single-user, lifestyle content |
| Development learnings | Architecture patterns, debugging insights, codebase knowledge | Technical, cross-project |
| Organizational wikis | Company knowledge, processes, decisions (Company A, Company B, Company C) | Multi-tenant, team-oriented |
| Operational insights | Sales patterns, meeting extractions, research summaries | Event-driven, business process |

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Event Sources                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │ Webhooks │ │  Cron    │ │  File    │ │  Manual  │ │ [User-defined]   │  │
│  │ (GitHub, │ │ Schedule │ │ Watcher  │ │  Tools   │ │                  │  │
│  │  Notion) │ │          │ │          │ │          │ │                  │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────────┬─────────┘  │
└───────┼────────────┼────────────┼────────────┼─────────────────┼────────────┘
        │            │            │            │                 │
        └────────────┴────────────┴─────┬──────┴─────────────────┘
                                        ▼
                         ┌──────────────────────────┐
                         │     Trigger Registry     │
                         │  (Event → Agent routing) │
                         └────────────┬─────────────┘
                                      │
                                      ▼
                         ┌──────────────────────────┐
                         │    Reasoning Agents      │
                         │  (Extraction Pipeline)   │
                         │                          │
                         │  - Claude (primary)      │
                         │  - OpenAI o1/o3          │
                         │  - Gemini thinking       │
                         │  - [Any reasoning LLM]   │
                         └────────────┬─────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Wiki Core                                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │   REST API      │  │   MCP Server    │  │   PostgreSQL + pgvector     │  │
│  │   (webhooks,    │  │   (agent        │  │   (documents, links,        │  │
│  │    web UI,      │◄─┤    tooling)     │  │    embeddings, versions)    │  │
│  │    integrations)│  │                 │  │                             │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Breakdown

#### 1. Wiki Core (PostgreSQL + pgvector)

The foundation storing all documents, relationships, and embeddings.

#### 2. REST API

Standard HTTP interface for:
- External integrations and webhooks
- Web UI (future)
- Administrative operations
- Non-agent consumers

#### 3. MCP Server

Model Context Protocol adapter providing tools for Claude Code and other MCP-compatible agents:
- `wiki_search` - Semantic and keyword search
- `wiki_read` - Retrieve document by ID or slug
- `wiki_write` - Create or update documents
- `wiki_link` - Create explicit links between documents
- `wiki_backlinks` - Get documents linking to a given page

#### 4. Trigger Registry

Configurable event source system. Each trigger defines:
- Event source configuration (webhook URL, cron expression, file path, etc.)
- Target tenant and namespace
- Agent configuration (model, system prompt, extraction template)
- Routing rules (where output goes in the wiki)

#### 5. Reasoning Agents

Model-agnostic extraction pipeline using reasoning-capable LLMs:
- Extended thinking / chain-of-thought for quality extraction
- Configurable per trigger type
- Determines: What's worth capturing? How to categorize? What to link?

---

## Data Model

### Core Schema

```sql
-- Tenants (personal, acme-corp, startup-x, company-y, etc.)
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(100) UNIQUE NOT NULL,
    name TEXT NOT NULL,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Namespaces within tenants (recipes, architecture, meetings, etc.)
CREATE TABLE namespaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    slug VARCHAR(100) NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    schema_hint JSONB,  -- optional structured fields for this namespace
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, slug)
);

-- Core document storage
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    namespace_id UUID REFERENCES namespaces(id),
    slug VARCHAR(255) NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    content_embedding vector(1536),

    -- Flexible structured data per document type
    metadata JSONB DEFAULT '{}',

    -- Provenance
    created_by VARCHAR(255),          -- 'agent:claude-session-xyz', 'human:braydon', 'trigger:github-pr'
    source_type VARCHAR(50),          -- 'conversation', 'transcript', 'pr', 'research', 'manual'
    source_ref TEXT,                  -- link/reference to original source

    -- Status
    is_archived BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(tenant_id, namespace_id, slug)
);

-- Explicit links between documents
CREATE TABLE links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    target_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    link_type VARCHAR(50) DEFAULT 'reference',  -- 'reference', 'contradicts', 'extends', 'supersedes', 'related'
    context TEXT,                               -- snippet/reason for the link
    created_by VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_id, target_id, link_type)
);

-- Version history for all document changes
CREATE TABLE document_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    version_number INT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB,
    changed_by VARCHAR(255),
    change_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(document_id, version_number)
);

-- Trigger registry
CREATE TABLE triggers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,

    -- Event source configuration
    trigger_type VARCHAR(50) NOT NULL,  -- 'webhook', 'cron', 'file_watch', 'manual'
    trigger_config JSONB NOT NULL,       -- type-specific config

    -- Agent configuration
    agent_model VARCHAR(100) DEFAULT 'claude-sonnet-4-20250514',
    agent_system_prompt TEXT,
    agent_extraction_template TEXT,

    -- Routing
    target_namespace_id UUID REFERENCES namespaces(id),
    routing_rules JSONB,                -- additional routing logic

    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger execution log
CREATE TABLE trigger_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trigger_id UUID REFERENCES triggers(id),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status VARCHAR(50),                  -- 'running', 'success', 'failed'
    input_summary TEXT,
    documents_created INT DEFAULT 0,
    documents_updated INT DEFAULT 0,
    error_message TEXT,
    execution_log JSONB
);

-- Indexes
CREATE INDEX idx_docs_tenant ON documents(tenant_id);
CREATE INDEX idx_docs_namespace ON documents(namespace_id);
CREATE INDEX idx_docs_tenant_ns_slug ON documents(tenant_id, namespace_id, slug);
CREATE INDEX idx_docs_embedding ON documents USING ivfflat (content_embedding vector_cosine_ops);
CREATE INDEX idx_docs_source_type ON documents(source_type);
CREATE INDEX idx_links_source ON links(source_id);
CREATE INDEX idx_links_target ON links(target_id);
CREATE INDEX idx_versions_doc ON document_versions(document_id);
CREATE INDEX idx_triggers_tenant ON triggers(tenant_id);
```

### Key Queries

```sql
-- Semantic search within a tenant/namespace
SELECT id, title, slug,
       1 - (content_embedding <=> $embedding) AS similarity
FROM documents
WHERE tenant_id = $tenant_id
  AND ($namespace_id IS NULL OR namespace_id = $namespace_id)
  AND is_archived = FALSE
ORDER BY content_embedding <=> $embedding
LIMIT 20;

-- Get backlinks (what documents link to this one?)
SELECT d.id, d.title, d.slug, l.link_type, l.context
FROM documents d
JOIN links l ON l.source_id = d.id
WHERE l.target_id = $document_id;

-- Get document with forward links
SELECT d.*,
       json_agg(json_build_object(
           'target_id', l.target_id,
           'link_type', l.link_type,
           'target_title', dt.title
       )) AS links
FROM documents d
LEFT JOIN links l ON l.source_id = d.id
LEFT JOIN documents dt ON dt.id = l.target_id
WHERE d.id = $document_id
GROUP BY d.id;

-- Combined semantic + link-based relevance
WITH semantic AS (
    SELECT id, 0.7 * (1 - (content_embedding <=> $embedding)) AS score
    FROM documents
    WHERE tenant_id = $tenant_id AND is_archived = FALSE
),
linked AS (
    SELECT target_id AS id, 0.3 AS score
    FROM links WHERE source_id = $doc_id
    UNION ALL
    SELECT source_id AS id, 0.2 AS score
    FROM links WHERE target_id = $doc_id
)
SELECT id, SUM(score) AS combined_score
FROM (SELECT * FROM semantic UNION ALL SELECT * FROM linked) combined
GROUP BY id
ORDER BY combined_score DESC
LIMIT 20;

-- Document version history
SELECT version_number, title, changed_by, change_reason, created_at
FROM document_versions
WHERE document_id = $document_id
ORDER BY version_number DESC;
```

---

## API Design

### REST API

Base URL: `/api/v1`

#### Tenants

```
GET    /tenants                    # List tenants (admin)
POST   /tenants                    # Create tenant
GET    /tenants/:slug              # Get tenant details
PATCH  /tenants/:slug              # Update tenant
```

#### Namespaces

```
GET    /tenants/:tenant/namespaces              # List namespaces
POST   /tenants/:tenant/namespaces              # Create namespace
GET    /tenants/:tenant/namespaces/:ns          # Get namespace
PATCH  /tenants/:tenant/namespaces/:ns          # Update namespace
```

#### Documents

```
GET    /tenants/:tenant/documents                    # List/search documents
POST   /tenants/:tenant/documents                    # Create document
GET    /tenants/:tenant/documents/:slug              # Get document
PUT    /tenants/:tenant/documents/:slug              # Update document
DELETE /tenants/:tenant/documents/:slug              # Archive document

GET    /tenants/:tenant/documents/:slug/versions     # Version history
GET    /tenants/:tenant/documents/:slug/backlinks    # Get backlinks
POST   /tenants/:tenant/documents/:slug/links        # Create link
```

#### Search

```
POST   /tenants/:tenant/search
Body: {
    "query": "string",           // semantic search query
    "namespace": "optional",
    "filters": {},               // metadata filters
    "limit": 20
}
```

#### Triggers

```
GET    /tenants/:tenant/triggers                # List triggers
POST   /tenants/:tenant/triggers                # Create trigger
GET    /tenants/:tenant/triggers/:id            # Get trigger
PATCH  /tenants/:tenant/triggers/:id            # Update trigger
DELETE /tenants/:tenant/triggers/:id            # Delete trigger
POST   /tenants/:tenant/triggers/:id/execute    # Manual execution

GET    /tenants/:tenant/triggers/:id/executions # Execution history
```

#### Webhooks (for trigger sources)

```
POST   /webhooks/:trigger_id                    # Receive webhook events
```

### MCP Server Tools

```typescript
// Search the wiki
wiki_search: {
    tenant: string;
    query: string;
    namespace?: string;
    limit?: number;
}

// Read a document
wiki_read: {
    tenant: string;
    slug: string;
    namespace?: string;
}

// Write/update a document
wiki_write: {
    tenant: string;
    namespace: string;
    slug: string;
    title: string;
    content: string;
    metadata?: object;
    source_type?: string;
    source_ref?: string;
}

// Create a link between documents
wiki_link: {
    tenant: string;
    source_slug: string;
    target_slug: string;
    link_type?: 'reference' | 'extends' | 'contradicts' | 'supersedes' | 'related';
    context?: string;
}

// Get backlinks for a document
wiki_backlinks: {
    tenant: string;
    slug: string;
}

// List recent documents (for discovery)
wiki_recent: {
    tenant: string;
    namespace?: string;
    limit?: number;
}
```

---

## Trigger System

### Trigger Types

#### 1. Webhook Triggers

Receive events from external systems.

```json
{
    "trigger_type": "webhook",
    "trigger_config": {
        "secret": "webhook_secret_for_validation",
        "event_filter": ["pull_request.merged", "issues.closed"]
    }
}
```

**Example sources:**
- GitHub (PR merged, issue closed)
- Notion (page updated)
- Slack (message in channel)
- Custom applications

#### 2. Cron Triggers

Scheduled execution for research and aggregation tasks.

```json
{
    "trigger_type": "cron",
    "trigger_config": {
        "schedule": "0 9 * * *",
        "task": {
            "type": "web_research",
            "query_template": "latest developments in {{topic}}",
            "topics": ["AI agents", "LLM architectures", "vector databases"]
        }
    }
}
```

**Example uses:**
- Daily Perplexity research on tracked topics
- Weekly news aggregation for industry keywords
- Periodic consolidation/gardening of wiki content

#### 3. File Watch Triggers

Monitor directories for new files.

```json
{
    "trigger_type": "file_watch",
    "trigger_config": {
        "path": "/transcripts",
        "patterns": ["*.txt", "*.vtt", "*.srt"],
        "poll_interval": 60
    }
}
```

**Example uses:**
- Meeting transcript processing
- Document ingestion
- Export processing from other tools

#### 4. API/Manual Triggers

Explicitly invoked by agents or humans.

```json
{
    "trigger_type": "manual",
    "trigger_config": {
        "allowed_callers": ["claude-code", "web-ui"]
    }
}
```

**Example uses:**
- End-of-session knowledge capture
- On-demand research requests
- Bulk import operations

### Agent Configuration

Each trigger includes agent configuration:

```json
{
    "agent_model": "claude-sonnet-4-20250514",
    "agent_system_prompt": "You are a knowledge extraction agent...",
    "agent_extraction_template": "Given the following {{source_type}}:\n\n{{content}}\n\nExtract key insights...",
    "agent_config": {
        "thinking_enabled": true,
        "max_tokens": 4096,
        "temperature": 0.3
    }
}
```

### Routing Rules

Control where extracted content lands:

```json
{
    "routing_rules": {
        "default_namespace": "meetings",
        "conditional": [
            {
                "match": {"metadata.topic": "architecture"},
                "namespace": "architecture"
            },
            {
                "match": {"metadata.topic": "sales"},
                "namespace": "sales-insights"
            }
        ],
        "auto_link": {
            "enabled": true,
            "similarity_threshold": 0.8
        }
    }
}
```

---

## Extraction Pipeline

### Pipeline Stages

When a trigger fires, the extraction pipeline:

1. **Ingest** - Receive raw content from trigger source
2. **Preprocess** - Normalize content (convert formats, chunk if needed)
3. **Extract** - Reasoning agent analyzes content:
   - What insights are worth capturing?
   - How should this be categorized?
   - What existing documents relate to this?
4. **Structure** - Format extracted content into document(s)
5. **Link** - Create explicit links to related documents
6. **Embed** - Generate embeddings for semantic search
7. **Store** - Write to database with full provenance

### Reasoning Agent Prompt Structure

```
You are a knowledge extraction agent for AI Wiki. Your task is to analyze
incoming content and extract insights worth preserving in a knowledge base.

## Context
Tenant: {{tenant_name}}
Namespace: {{namespace_name}}
Source type: {{source_type}}

## Existing Related Documents
{{relevant_documents}}

## Input Content
{{content}}

## Your Task
1. Identify key insights, learnings, or knowledge worth capturing
2. Determine if this updates existing documents or creates new ones
3. Suggest links to related existing documents
4. Structure the output appropriately

Think through what's actually valuable here. Not everything needs to be captured.
Focus on insights that would be useful to retrieve later.

## Output Format
{
    "documents": [
        {
            "action": "create" | "update",
            "slug": "suggested-slug",
            "title": "Document Title",
            "content": "Markdown content...",
            "metadata": {},
            "links": [
                {"target_slug": "existing-doc", "link_type": "extends", "context": "why linked"}
            ]
        }
    ],
    "reasoning": "Explanation of extraction decisions"
}
```

---

## Multi-Tenancy

### Tenant Isolation

- All queries scoped by `tenant_id`
- Row-level security in PostgreSQL
- Separate API keys per tenant
- Namespace-level permissions within tenants

### Tenant Configuration

```json
{
    "slug": "acme-corp",
    "name": "Acme Corp",
    "settings": {
        "default_model": "claude-sonnet-4-20250514",
        "auto_link_threshold": 0.75,
        "require_source_ref": true,
        "allowed_source_types": ["conversation", "pr", "transcript", "research"]
    }
}
```

### Example Tenant Setup

| Tenant | Purpose | Namespaces |
|--------|---------|------------|
| `personal` | Braydon's personal knowledge | recipes, travel, preferences, learnings |
| `acme-corp` | Acme Corp company wiki | architecture, processes, decisions, people |
| `startup-x` | Startup X company wiki | projects, clients, practices |
| `company-y` | Company Y company wiki | product, engineering, research |
| `dev-learnings` | Cross-project development insights | patterns, debugging, tools, architectures |

---

## Technology Stack

### Backend

- **Runtime**: Node.js with TypeScript or Python with FastAPI
- **Database**: PostgreSQL 15+ with pgvector extension
- **Queue**: Redis or PostgreSQL-based queue for trigger processing
- **Embeddings**: OpenAI `text-embedding-3-small` or similar

### MCP Server

- TypeScript MCP SDK
- Exposes wiki tools to Claude Code and compatible agents

### Infrastructure

- **Deployment**: Docker containers
- **Hosting**: Self-hosted or cloud (Railway, Render, Fly.io)
- **Monitoring**: Structured logging, execution metrics

---

## Implementation Phases

### Phase 1: Core Foundation

- PostgreSQL schema setup with pgvector
- Basic REST API (CRUD for tenants, namespaces, documents)
- Document versioning
- Embedding generation on write
- Semantic search

**Deliverable**: Working wiki with manual read/write via API

### Phase 2: MCP Integration

- MCP server implementation
- Tools: wiki_search, wiki_read, wiki_write, wiki_link, wiki_backlinks
- Integration with Claude Code

**Deliverable**: Agents can read/write wiki via MCP tools

### Phase 3: Trigger System

- Trigger registry and configuration
- Webhook receiver
- Cron scheduler
- Extraction pipeline with reasoning agents
- Execution logging

**Deliverable**: Automated knowledge capture from configured sources

### Phase 4: Advanced Features

- Auto-linking based on semantic similarity
- Conflict detection (contradictory information)
- Gardening agents (consolidation, cleanup, cross-linking)
- Web UI for browsing/searching
- Analytics and insights

---

## Open Questions

1. **Embedding model choice** - OpenAI vs. open-source (e.g., BGE, Nomic) for cost/privacy tradeoffs?

2. **Chunking strategy** - For long documents, embed the whole thing or chunk into sections?

3. **Real-time vs. batch** - Should embedding/linking happen synchronously on write or in background?

4. **Web UI priority** - Is a browsing interface needed for MVP, or is MCP/API sufficient?

5. **Authentication** - API keys per tenant? OAuth for web UI? How do agents authenticate?

6. **Hosting model** - Self-hosted only? Or offer a hosted multi-tenant SaaS option?

---

## Success Metrics

- **Capture rate**: Knowledge captured vs. knowledge that could have been captured
- **Retrieval quality**: Are agents/humans finding relevant documents?
- **Link density**: Average links per document (higher = better connected knowledge)
- **Agent contribution ratio**: % of content from agents vs. manual entry
- **Query latency**: p50/p95 for search operations
- **Trigger reliability**: Success rate of automated extractions

---

## Appendix: Example Workflows

### Workflow 1: Meeting Transcript Processing

1. Meeting recorded and transcribed (Otter, Granola, etc.)
2. Transcript file dropped in watched folder
3. File watch trigger fires
4. Reasoning agent extracts:
   - Key decisions made
   - Action items
   - Topics discussed
   - Questions raised
5. Creates/updates documents in `meetings` namespace
6. Auto-links to related project docs, people, previous meetings

### Workflow 2: GitHub PR Documentation

1. PR merged to main branch
2. GitHub webhook fires
3. Reasoning agent analyzes:
   - What architectural decisions were made?
   - What patterns were introduced?
   - What problems were solved?
4. Creates document in `architecture` or `patterns` namespace
5. Links to related codebase docs

### Workflow 3: Daily Research Aggregation

1. Cron trigger fires at 9am
2. Agent queries Perplexity for tracked topics
3. Extracts notable developments, new papers, industry news
4. Updates or creates documents in `research` namespace
5. Links to existing related research

### Workflow 4: Claude Session Knowledge Capture

1. Development session ends
2. Manual trigger or webhook from Claude Code
3. Agent reviews session transcript
4. Extracts:
   - Codebase learnings
   - Debugging insights
   - Architectural decisions
   - Patterns discovered
5. Creates documents in appropriate namespace
6. Links to existing codebase documentation
