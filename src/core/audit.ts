import { AuditLogEntry, OperationType, ModuleType, PaginationParams, PaginationResult, UsageInfo } from '../types';

function generateId(): string {
  return 'log_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function generateTraceId(): string {
  return 'trace_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
}

export class AuditManager {
  private logs: AuditLogEntry[] = [];
  private maxLogs = 10000;

  record(params: {
    traceId?: string;
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
  }): AuditLogEntry {
    const entry: AuditLogEntry = {
      id: generateId(),
      traceId: params.traceId || generateTraceId(),
      userId: params.userId,
      tenantId: params.tenantId,
      module: params.module,
      operation: params.operation,
      params: { ...params.params },
      resultCode: params.resultCode,
      success: params.success,
      usage: params.usage,
      ip: params.ip,
      userAgent: params.userAgent,
      createdAt: Date.now(),
    };

    this.logs.unshift(entry);

    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }

    return entry;
  }

  list(
    options: PaginationParams & {
      userId?: string;
      tenantId?: string;
      module?: ModuleType;
      operation?: OperationType;
      success?: boolean;
      startTime?: number;
      endTime?: number;
      traceId?: string;
    } = {}
  ): PaginationResult<AuditLogEntry> {
    const { page = 1, pageSize = 20 } = options;

    let filtered = this.logs;

    if (options.userId) {
      filtered = filtered.filter((log) => log.userId === options.userId);
    }

    if (options.tenantId) {
      filtered = filtered.filter((log) => log.tenantId === options.tenantId);
    }

    if (options.module) {
      filtered = filtered.filter((log) => log.module === options.module);
    }

    if (options.operation) {
      filtered = filtered.filter((log) => log.operation === options.operation);
    }

    if (options.success !== undefined) {
      filtered = filtered.filter((log) => log.success === options.success);
    }

    if (options.startTime) {
      filtered = filtered.filter((log) => log.createdAt >= options.startTime!);
    }

    if (options.endTime) {
      filtered = filtered.filter((log) => log.createdAt <= options.endTime!);
    }

    if (options.traceId) {
      filtered = filtered.filter((log) => log.traceId === options.traceId);
    }

    const total = filtered.length;
    const startIndex = (page - 1) * pageSize;
    const items = filtered.slice(startIndex, startIndex + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
      hasMore: startIndex + pageSize < total,
    };
  }

  get(id: string): AuditLogEntry | undefined {
    return this.logs.find((log) => log.id === id);
  }

  getByTraceId(traceId: string): AuditLogEntry[] {
    return this.logs.filter((log) => log.traceId === traceId);
  }

  clear(): void {
    this.logs = [];
  }

  setMaxLogs(max: number): void {
    this.maxLogs = max;
    if (this.logs.length > max) {
      this.logs = this.logs.slice(0, max);
    }
  }
}
