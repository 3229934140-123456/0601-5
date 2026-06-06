export type ModuleType =
  | 'session'
  | 'prompt'
  | 'document'
  | 'image'
  | 'task'
  | 'audit'
  | 'config';

export type OperationType =
  | 'session.create'
  | 'session.chat'
  | 'session.history'
  | 'session.clear'
  | 'prompt.fill'
  | 'prompt.template.list'
  | 'prompt.template.create'
  | 'prompt.template.get'
  | 'prompt.template.update'
  | 'prompt.template.delete'
  | 'document.summarize'
  | 'document.extractKeyPoints'
  | 'document.classify'
  | 'document.sensitiveCheck'
  | 'image.describe'
  | 'image.compare'
  | 'task.submit'
  | 'task.status'
  | 'task.result'
  | 'task.list'
  | 'task.cancel'
  | 'audit.log.list'
  | 'audit.log.get'
  | 'config.get'
  | 'config.set'
  | 'config.list'
  | 'usage.stats';

export interface AIPlatformConfig {
  apiKey: string;
  apiBaseUrl?: string;
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
  appId?: string;
}

export interface RequestOptions {
  timeout?: number;
  maxRetries?: number;
  traceId?: string;
}

export interface BaseResponse<T = unknown> {
  success: boolean;
  code: number;
  message: string;
  data?: T;
  traceId: string;
  timestamp: number;
  usage?: UsageInfo;
}

export interface UsageInfo {
  tokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  images?: number;
  documents?: number;
  requests: number;
  duration: number;
}

export interface PermissionContext {
  userId: string;
  role?: string;
  permissions?: string[];
  tenantId?: string;
}

export interface AuditLogEntry {
  id: string;
  traceId: string;
  userId: string;
  tenantId?: string;
  module: ModuleType;
  operation: OperationType;
  params: Record<string, unknown>;
  resultCode: number;
  success: boolean;
  usage?: UsageInfo;
  ip?: string;
  userAgent?: string;
  createdAt: number;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginationResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
