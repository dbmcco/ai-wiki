-- AI Wiki Initial Schema
-- Requires PostgreSQL 15+ with pgvector extension

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Tenants (personal, synthyra, lfw, navicyte, etc.)
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(100) UNIQUE NOT NULL,
    name TEXT NOT NULL,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Namespaces within tenants (recipes, architecture, meetings, etc.)
CREATE TABLE namespaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    slug VARCHAR(100) NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    schema_hint JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, slug)
);

-- Core document storage
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    namespace_id UUID REFERENCES namespaces(id) ON DELETE SET NULL,
    slug VARCHAR(255) NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    content_embedding vector(1536),

    -- Flexible structured data per document type
    metadata JSONB DEFAULT '{}',

    -- Provenance
    created_by VARCHAR(255),
    source_type VARCHAR(50),
    source_ref TEXT,

    -- Status
    is_archived BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(tenant_id, namespace_id, slug)
);

-- Explicit links between documents
CREATE TABLE links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    target_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    link_type VARCHAR(50) DEFAULT 'reference',
    context TEXT,
    created_by VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_id, target_id, link_type)
);

-- Version history for all document changes
CREATE TABLE document_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
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
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,

    -- Event source configuration
    trigger_type VARCHAR(50) NOT NULL,
    trigger_config JSONB NOT NULL,

    -- Agent configuration
    agent_model VARCHAR(100) DEFAULT 'claude-sonnet-4-20250514',
    agent_system_prompt TEXT,
    agent_extraction_template TEXT,

    -- Routing
    target_namespace_id UUID REFERENCES namespaces(id) ON DELETE SET NULL,
    routing_rules JSONB,

    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger execution log
CREATE TABLE trigger_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trigger_id UUID NOT NULL REFERENCES triggers(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status VARCHAR(50) DEFAULT 'running',
    input_summary TEXT,
    documents_created INT DEFAULT 0,
    documents_updated INT DEFAULT 0,
    error_message TEXT,
    execution_log JSONB
);

-- Indexes for performance

-- Tenant lookups
CREATE INDEX idx_namespaces_tenant ON namespaces(tenant_id);

-- Document lookups
CREATE INDEX idx_docs_tenant ON documents(tenant_id);
CREATE INDEX idx_docs_namespace ON documents(namespace_id);
CREATE INDEX idx_docs_tenant_ns_slug ON documents(tenant_id, namespace_id, slug);
CREATE INDEX idx_docs_source_type ON documents(source_type);
CREATE INDEX idx_docs_created_at ON documents(created_at DESC);
CREATE INDEX idx_docs_updated_at ON documents(updated_at DESC);

-- Vector similarity search (IVFFlat for balance of speed/accuracy)
CREATE INDEX idx_docs_embedding ON documents USING ivfflat (content_embedding vector_cosine_ops)
    WITH (lists = 100);

-- Link traversal
CREATE INDEX idx_links_source ON links(source_id);
CREATE INDEX idx_links_target ON links(target_id);

-- Version history
CREATE INDEX idx_versions_doc ON document_versions(document_id);
CREATE INDEX idx_versions_doc_num ON document_versions(document_id, version_number DESC);

-- Trigger lookups
CREATE INDEX idx_triggers_tenant ON triggers(tenant_id);
CREATE INDEX idx_triggers_active ON triggers(is_active) WHERE is_active = TRUE;

-- Execution history
CREATE INDEX idx_executions_trigger ON trigger_executions(trigger_id);
CREATE INDEX idx_executions_status ON trigger_executions(status);
CREATE INDEX idx_executions_started ON trigger_executions(started_at DESC);

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at trigger to documents
CREATE TRIGGER update_documents_updated_at
    BEFORE UPDATE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply updated_at trigger to triggers
CREATE TRIGGER update_triggers_updated_at
    BEFORE UPDATE ON triggers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
