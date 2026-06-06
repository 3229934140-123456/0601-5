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
  successRequests: number;
  failedRequests: number;
  duration: number;
  success: boolean;
  traceId?: string;
}

export interface UsageStatsOptions {
  userId?: string;
  tenantId?: string;
  module?: string;
  operation?: string;
  startDate?: string;
  endDate?: string;
  groupBy?: 'day' | 'module' | 'operation' | 'user' | 'tenant';
  successOnly?: boolean;
}

export interface UsageBreakdownItem {
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  images: number;
  documents: number;
  requests: number;
  successRequests: number;
  failedRequests: number;
  duration: number;
}

export interface UsageStatsResult {
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalImages: number;
  totalDocuments: number;
  totalRequests: number;
  totalSuccessRequests: number;
  totalFailedRequests: number;
  totalDuration: number;
  averageDuration: number;
  successRate: number;
  breakdown?: Record<string, UsageBreakdownItem>;
}

export class UsageManager {
  private records: UsageRecord[] = [];
  private monthlyQuotas: Map<string, { tokens?: number; requests?: number; images?: number; documents?: number }> = new Map();
  private maxRecords: number = 100000;

  record(
    userId: string,
    module: string,
    operation: string,
    usage: UsageInfo,
    options: {
      tenantId?: string;
      success?: boolean;
      traceId?: string;
    } = {}
  ): void {
    const today = new Date().toISOString().split('T')[0];
    const success = options.success ?? true;

    this.records.push({
      date: today,
      userId,
      tenantId: options.tenantId,
      module,
      operation,
      tokens: usage.tokens || usage.inputTokens + usage.outputTokens || 0,
      inputTokens: usage.inputTokens || 0,
      outputTokens: usage.outputTokens || 0,
      images: usage.images || 0,
      documents: usage.documents || 0,
      requests: 1,
      successRequests: success ? 1 : 0,
      failedRequests: success ? 0 : 1,
      duration: usage.duration || 0,
      success,
      traceId: options.traceId,
    });

    if (this.records.length > this.maxRecords) {
      const removeCount = this.records.length - this.maxRecords;
      this.records.splice(0, removeCount);
    }
  }

  getStats(options: UsageStatsOptions = {}): UsageStatsResult {
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

    if (options.operation) {
      filtered = filtered.filter((r) => r.operation === options.operation);
    }

    if (options.startDate) {
      filtered = filtered.filter((r) => r.date >= options.startDate!);
    }

    if (options.endDate) {
      filtered = filtered.filter((r) => r.date <= options.endDate!);
    }

    if (options.successOnly) {
      filtered = filtered.filter((r) => r.success);
    }

    const stats: Omit<UsageStatsResult, 'breakdown' | 'averageDuration' | 'successRate'> = {
      totalTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalImages: 0,
      totalDocuments: 0,
      totalRequests: 0,
      totalSuccessRequests: 0,
      totalFailedRequests: 0,
      totalDuration: 0,
    };

    const breakdown: Record<string, UsageBreakdownItem> = {};

    for (const record of filtered) {
      stats.totalTokens += record.tokens;
      stats.totalInputTokens += record.inputTokens;
      stats.totalOutputTokens += record.outputTokens;
      stats.totalImages += record.images;
      stats.totalDocuments += record.documents;
      stats.totalRequests += record.requests;
      stats.totalSuccessRequests += record.successRequests;
      stats.totalFailedRequests += record.failedRequests;
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
          case 'tenant':
            key = record.tenantId || 'unknown';
            break;
          default:
            key = record.date;
        }

        if (!breakdown[key]) {
          breakdown[key] = {
            tokens: 0,
            inputTokens: 0,
            outputTokens: 0,
            images: 0,
            documents: 0,
            requests: 0,
            successRequests: 0,
            failedRequests: 0,
            duration: 0,
          };
        }

        breakdown[key].tokens += record.tokens;
        breakdown[key].inputTokens += record.inputTokens;
        breakdown[key].outputTokens += record.outputTokens;
        breakdown[key].images += record.images;
        breakdown[key].documents += record.documents;
        breakdown[key].requests += record.requests;
        breakdown[key].successRequests += record.successRequests;
        breakdown[key].failedRequests += record.failedRequests;
        breakdown[key].duration += record.duration;
      }
    }

    const result: UsageStatsResult = {
      ...stats,
      averageDuration: stats.totalRequests > 0 ? stats.totalDuration / stats.totalRequests : 0,
      successRate: stats.totalRequests > 0 ? stats.totalSuccessRequests / stats.totalRequests : 0,
    };

    if (options.groupBy) {
      result.breakdown = breakdown;
    }

    return result;
  }

  setMonthlyQuota(
    userId: string,
    quota: { tokens?: number; requests?: number; images?: number; documents?: number }
  ): void {
    this.monthlyQuotas.set(userId, quota);
  }

  checkQuota(userId: string): {
    used: {
      tokens: number;
      requests: number;
      images: number;
      documents: number;
    };
    quota: {
      tokens?: number;
      requests?: number;
      images?: number;
      documents?: number;
    };
    remaining: {
      tokens?: number;
      requests?: number;
      images?: number;
      documents?: number;
    };
    isExceeded: boolean;
  } {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const stats = this.getStats({ userId, startDate: monthStart });
    const quota = this.monthlyQuotas.get(userId) || {};

    const used = {
      tokens: stats.totalTokens,
      requests: stats.totalRequests,
      images: stats.totalImages,
      documents: stats.totalDocuments,
    };

    const remaining: typeof used & Record<string, number | undefined> = {};
    let isExceeded = false;

    if (quota.tokens !== undefined) {
      remaining.tokens = Math.max(0, quota.tokens - used.tokens);
      if (used.tokens > quota.tokens) isExceeded = true;
    }

    if (quota.requests !== undefined) {
      remaining.requests = Math.max(0, quota.requests - used.requests);
      if (used.requests > quota.requests) isExceeded = true;
    }

    if (quota.images !== undefined) {
      remaining.images = Math.max(0, quota.images - used.images);
      if (used.images > quota.images) isExceeded = true;
    }

    if (quota.documents !== undefined) {
      remaining.documents = Math.max(0, quota.documents - used.documents);
      if (used.documents > quota.documents) isExceeded = true;
    }

    return {
      used,
      quota,
      remaining,
      isExceeded,
    };
  }

  getTopUsers(limit: number = 10, options: { startDate?: string; endDate?: string } = {}): {
    userId: string;
    tokens: number;
    requests: number;
  }[] {
    const userStats: Record<string, { tokens: number; requests: number }> = {};
    let filtered = this.records;

    if (options.startDate) {
      filtered = filtered.filter((r) => r.date >= options.startDate!);
    }
    if (options.endDate) {
      filtered = filtered.filter((r) => r.date <= options.endDate!);
    }

    for (const record of filtered) {
      if (!userStats[record.userId]) {
        userStats[record.userId] = { tokens: 0, requests: 0 };
      }
      userStats[record.userId].tokens += record.tokens;
      userStats[record.userId].requests += record.requests;
    }

    return Object.entries(userStats)
      .map(([userId, stats]) => ({ userId, ...stats }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, limit);
  }

  getDailyTrend(days: number = 7, options: { userId?: string; module?: string } = {}): {
    date: string;
    tokens: number;
    requests: number;
    successRequests: number;
    failedRequests: number;
  }[] {
    const result: { date: string; tokens: number; requests: number; successRequests: number; failedRequests: number }[] = [];
    const today = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const dayStats = this.getStats({
        ...options,
        startDate: dateStr,
        endDate: dateStr,
      });

      result.push({
        date: dateStr,
        tokens: dayStats.totalTokens,
        requests: dayStats.totalRequests,
        successRequests: dayStats.totalSuccessRequests,
        failedRequests: dayStats.totalFailedRequests,
      });
    }

    return result;
  }

  clearOldRecords(beforeDate: string): number {
    const beforeCount = this.records.length;
    this.records = this.records.filter((r) => r.date >= beforeDate);
    return beforeCount - this.records.length;
  }

  setMaxRecords(max: number): void {
    this.maxRecords = max;
    if (this.records.length > max) {
      this.records = this.records.slice(this.records.length - max);
    }
  }

  getRecordCount(): number {
    return this.records.length;
  }
}
