-- AI Wiki Database Schema
-- This file is auto-generated from migrations for reference
-- Use migrations for actual database setup

-- See migrations/001_initial_schema.sql for the full schema

-- Quick reference of tables:
-- - tenants: Multi-tenant support (personal, company wikis)
-- - namespaces: Categories within tenants (recipes, architecture, etc.)
-- - documents: Core wiki pages with embeddings
-- - links: Explicit relationships between documents
-- - document_versions: Version history for all changes
-- - triggers: Event source configuration (webhooks, cron, etc.)
-- - trigger_executions: Execution history and logging
