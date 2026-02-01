// Core domain types for AI Wiki

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  settings: TenantSettings;
  createdAt: Date;
}

export interface TenantSettings {
  defaultModel?: string;
  autoLinkThreshold?: number;
  requireSourceRef?: boolean;
  allowedSourceTypes?: string[];
}

export interface Namespace {
  id: string;
  tenantId: string;
  slug: string;
  name: string;
  description?: string;
  schemaHint?: Record<string, unknown>;
  createdAt: Date;
}

export interface Document {
  id: string;
  tenantId: string;
  namespaceId?: string;
  slug: string;
  title: string;
  content: string;
  contentEmbedding?: number[];
  metadata: Record<string, unknown>;
  createdBy?: string;
  sourceType?: string;
  sourceRef?: string;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Link {
  id: string;
  sourceId: string;
  targetId: string;
  linkType: LinkType;
  context?: string;
  createdBy?: string;
  createdAt: Date;
}

export type LinkType = 'reference' | 'contradicts' | 'extends' | 'supersedes' | 'related';

export interface DocumentVersion {
  id: string;
  documentId: string;
  versionNumber: number;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  changedBy?: string;
  changeReason?: string;
  createdAt: Date;
}

export interface Trigger {
  id: string;
  tenantId?: string;
  name: string;
  description?: string;
  triggerType: TriggerType;
  triggerConfig: Record<string, unknown>;
  agentModel: string;
  agentSystemPrompt?: string;
  agentExtractionTemplate?: string;
  targetNamespaceId?: string;
  routingRules?: RoutingRules;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type TriggerType = 'webhook' | 'cron' | 'file_watch' | 'manual';

export interface RoutingRules {
  defaultNamespace?: string;
  conditional?: ConditionalRoute[];
  autoLink?: {
    enabled: boolean;
    similarityThreshold?: number;
  };
}

export interface ConditionalRoute {
  match: Record<string, unknown>;
  namespace: string;
}

export interface TriggerExecution {
  id: string;
  triggerId: string;
  startedAt: Date;
  completedAt?: Date;
  status: 'running' | 'success' | 'failed';
  inputSummary?: string;
  documentsCreated: number;
  documentsUpdated: number;
  errorMessage?: string;
  executionLog?: Record<string, unknown>;
}
