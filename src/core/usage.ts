import { UsageInfo } from '../types';

export interface UsageRecord {
  date: string;
  userId: string;
  tenantId?: string;
  module: string;
  operation: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  images: number;
  documents: number;
  requests: number;
  duration: number;
}

export class UsageManager {
  private records: UsageRecord[] = [];
  private monthlyQuotas: Map<string, { tokens?: number; requests?: number }> = new Map();

  record(
    userId: string,
    module: string,
    operation: string,
    usage: UsageInfo,
    tenantId?: string
  ): void {
    const today = new Date().toISOString().split('T')[0];

    this.records.push({
      date: today,
      userId,
      tenantId,
      module,
      operation,
      tokens: usage.tokens || 0,
      inputTokens: usage.inputTokens || 0,
      outputTokens: usage.outputTokens || 0,
      images: usage.images || 0,
      documents: usage.documents || 0,
      requests: usage.requests || 1,
      duration: usage.duration || 0,
    });
  }

  getStats(options: {
    userId?: string;
    tenantId?: string;
    module?: string;
    startDate?: string;
    endDate?: string;
    groupBy?: 'day' | 'module' | 'operation' | 'user';
  } = {}): {
    totalTokens: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalImages: number;
    totalDocuments: number;
    totalRequests: number;
    totalDuration: number;
    breakdown?: Record<string, {
      tokens: number;
      requests: number;
    }>;
  } {
    let filtered = this.records;

    if (options.userId) {
      filtered = filtered.filter((r) => r.userId === options.userId);
    }

    if (options.tenantId) {
      filtered = filtered.filter((r) => r.tenantId === options.tenantId);
    }

    if (options.module) {
      filtered = filtered.filter((r) => r.module === options.module);
    }

    if (options.startDate) {
      filtered = filtered.filter((r) => r.date >= options.startDate!);
    }

    if (options.endDate) {
      filtered = filtered.filter((r) => r.date <= options.endDate!);
    }

    const stats = {
      totalTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalImages: 0,
      totalDocuments: 0,
      totalRequests: 0,
      totalDuration: 0,
    };

    const breakdown: Record<string, { tokens: number; requests: number }> = {};

    for (const record of filtered) {
      stats.totalTokens += record.tokens;
      stats.totalInputTokens += record.inputTokens;
      stats.totalOutputTokens += record.outputTokens;
      stats.totalImages += record.images;
      stats.totalDocuments += record.documents;
      stats.totalRequests += record.requests;
      stats.totalDuration += record.duration;

      if (options.groupBy) {
        let key: string;
        switch (options.groupBy) {
          case 'day':
            key = record.date;
            break;
          case 'module':
            key = record.module;
            break;
          case 'operation':
            key = record.operation;
            break;
          case 'user':
            key = record.userId;
            break;
          default:
            key = record.date;
        }

        if (!breakdown[key]) {
          breakdown[key] = { tokens: 0, requests: 0 };
        }
        breakdown[key].tokens += record.tokens;
        breakdown[key].requests += record.requests;
      }
    }

    if (options.groupBy) {
      return { ...stats, breakdown };
    }

    return stats;
  }

  setMonthlyQuota(userId: string, tokens?: number, requests?: number): void {
    this.monthlyQuotas.set(userId, { tokens, requests });
  }

  checkQuota(userId: string): {
    usedTokens: number;
    usedRequests: number;
    tokenQuota?: number;
    requestQuota?: number;
    tokenRemaining?: number;
    requestRemaining?: number;
  } {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const stats = this.getStats({ userId, startDate: monthStart });
    const quota = this.monthlyQuotas.get(userId);

    const result: {
      usedTokens: number;
      usedRequests: number;
      tokenQuota?: number;
      requestQuota?: number;
      tokenRemaining?: number;
      requestRemaining?: number;
    } = {
      usedTokens: stats.totalTokens,
      usedRequests: stats.totalRequests,
    };

    if (quota?.tokens !== undefined) {
      result.tokenQuota = quota.tokens;
      result.tokenRemaining = Math.max(0, quota.tokens - stats.totalTokens);
    }

    if (quota?.requests !== undefined) {
      result.requestQuota = quota.requests;
      result.requestRemaining = Math.max(0, quota.requests - stats.totalRequests);
    }

    return result;
  }

  clearOldRecords(beforeDate: string): number {
    const beforeCount = this.records.length;
    this.records = this.records.filter((r) => r.date >= beforeDate);
    return beforeCount - this.records.length;
  }
}
