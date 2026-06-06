import { generateTraceId } from '../utils';
import { ConfigManager } from '../core/config';
import { RetryUtil } from '../core/retry';
import { PermissionManager } from '../core/permission';
import { UsageManager } from '../core/usage';
import { AuditManager } from '../core/audit';
import { SessionManager, ChatMessage, ChatOptions } from '../modules/session';
import { PromptManager, PromptTemplate } from '../modules/prompt';
import {
  DocumentManager,
  SummaryResult,
  KeyPointsResult,
  ClassificationResult,
  SensitiveCheckResult,
} from '../modules/document';
import { ImageManager, ImageDescriptionResult, ImageCompareResult } from '../modules/image';
import { TaskManager, Task, TaskType, TaskSubmitOptions } from '../modules/task';
import {
  AIPlatformConfig,
  BaseResponse,
  RequestOptions,
  PermissionContext,
  OperationType,
  UsageInfo,
  PaginationParams,
  PaginationResult,
  AuditLogEntry,
  ModuleType,
} from '../types';

export class AIPlatformClient {
  readonly config: ConfigManager;
  readonly permission: PermissionManager;
  readonly usage: UsageManager;
  readonly audit: AuditManager;
  readonly session: SessionManager;
  readonly prompt: PromptManager;
  readonly document: DocumentManager;
  readonly image: ImageManager;
  readonly task: TaskManager;

  private defaultPermissionContext?: PermissionContext;

  constructor(config: AIPlatformConfig) {
    this.config = new ConfigManager(config);
    this.config.validate();

    this.permission = new PermissionManager();
    this.usage = new UsageManager();
    this.audit = new AuditManager();
    this.session = new SessionManager();
    this.prompt = new PromptManager();
    this.document = new DocumentManager();
    this.image = new ImageManager();
    this.task = new TaskManager();
  }

  setDefaultPermissionContext(context: PermissionContext): void {
    this.defaultPermissionContext = context;
  }

  private getPermissionContext(provided?: PermissionContext): PermissionContext {
    if (provided) return provided;
    if (this.defaultPermissionContext) return this.defaultPermissionContext;
    return { userId: 'anonymous' };
  }

  private createResponse<T>(
    success: boolean,
    code: number,
    message: string,
    data?: T,
    traceId?: string,
    usage?: UsageInfo
  ): BaseResponse<T> {
    return {
      success,
      code,
      message,
      data,
      traceId: traceId || generateTraceId(),
      timestamp: Date.now(),
      usage,
    };
  }

  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    options?: RequestOptions
  ): Promise<T> {
    const maxRetries = options?.maxRetries ?? this.config.get('maxRetries') ?? 3;
    const delay = this.config.get('retryDelay') || 1000;

    return RetryUtil.execute(fn, {
      maxRetries,
      delay,
      shouldRetry: (error) => RetryUtil.isRetryableError(error),
    });
  }

  private recordUsage(
    userId: string,
    module: ModuleType,
    operation: OperationType,
    usage: UsageInfo,
    tenantId?: string
  ): void {
    this.usage.record(userId, module, operation, usage, tenantId);
  }

  private recordAudit(
    traceId: string,
    userId: string,
    module: ModuleType,
    operation: OperationType,
    params: Record<string, unknown>,
    success: boolean,
    code: number,
    usage?: UsageInfo,
    tenantId?: string
  ): void {
    this.audit.record({
      traceId,
      userId,
      tenantId,
      module,
      operation,
      params,
      resultCode: code,
      success,
      usage,
    });
  }

  private checkPermission(
    context: PermissionContext,
    operation: OperationType
  ): void {
    this.permission.require(context, operation);
  }

  async call<T = unknown>(
    operation: OperationType,
    params: Record<string, unknown> = {},
    options?: RequestOptions & { permissionContext?: PermissionContext }
  ): Promise<BaseResponse<T>> {
    const traceId = options?.traceId || generateTraceId();
    const permContext = this.getPermissionContext(options?.permissionContext);
    const startTime = Date.now();

    try {
      this.checkPermission(permContext, operation);

      const result = await this.executeWithRetry(async () => {
        return await this.dispatchOperation(operation, params) as T;
      }, options);

      const duration = Date.now() - startTime;
      const usage: UsageInfo = {
        requests: 1,
        duration,
      };

      const module = operation.split('.')[0] as ModuleType;
      this.recordUsage(permContext.userId, module, operation, usage, permContext.tenantId);
      this.recordAudit(traceId, permContext.userId, module, operation, params, true, 0, usage, permContext.tenantId);

      return this.createResponse(true, 0, 'success', result, traceId, usage);
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof Error && (error as any).code ? (error as any).code : -1;
      const usage: UsageInfo = {
        requests: 1,
        duration,
      };

      const module = operation.split('.')[0] as ModuleType;
      this.recordUsage(permContext.userId, module, operation, usage, permContext.tenantId);
      this.recordAudit(traceId, permContext.userId, module, operation, params, false, code, usage, permContext.tenantId);

      return this.createResponse(false, code, message, undefined, traceId, usage);
    }
  }

  private async dispatchOperation(
    operation: OperationType,
    params: Record<string, unknown>
  ): Promise<unknown> {
    switch (operation) {
      case 'session.create':
        return this.handleSessionCreate(params);
      case 'session.chat':
        return this.handleSessionChat(params);
      case 'session.history':
        return this.handleSessionHistory(params);
      case 'session.clear':
        return this.handleSessionClear(params);

      case 'prompt.fill':
        return this.handlePromptFill(params);
      case 'prompt.template.list':
        return this.handlePromptTemplateList(params);
      case 'prompt.template.create':
        return this.handlePromptTemplateCreate(params);
      case 'prompt.template.get':
        return this.handlePromptTemplateGet(params);
      case 'prompt.template.update':
        return this.handlePromptTemplateUpdate(params);
      case 'prompt.template.delete':
        return this.handlePromptTemplateDelete(params);

      case 'document.summarize':
        return this.handleDocumentSummarize(params);
      case 'document.extractKeyPoints':
        return this.handleDocumentExtractKeyPoints(params);
      case 'document.classify':
        return this.handleDocumentClassify(params);
      case 'document.sensitiveCheck':
        return this.handleDocumentSensitiveCheck(params);

      case 'image.describe':
        return this.handleImageDescribe(params);
      case 'image.compare':
        return this.handleImageCompare(params);

      case 'task.submit':
        return this.handleTaskSubmit(params);
      case 'task.status':
        return this.handleTaskStatus(params);
      case 'task.result':
        return this.handleTaskResult(params);
      case 'task.list':
        return this.handleTaskList(params);
      case 'task.cancel':
        return this.handleTaskCancel(params);

      case 'audit.log.list':
        return this.handleAuditLogList(params);
      case 'audit.log.get':
        return this.handleAuditLogGet(params);

      case 'config.get':
        return this.handleConfigGet(params);
      case 'config.set':
        return this.handleConfigSet(params);
      case 'config.list':
        return this.handleConfigList(params);

      case 'usage.stats':
        return this.handleUsageStats(params);

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  private handleSessionCreate(params: Record<string, unknown>) {
    const result = this.session.create({
      userId: String(params.userId || 'anonymous'),
      title: params.title as string | undefined,
      systemPrompt: params.systemPrompt as string | undefined,
      model: params.model as string | undefined,
      temperature: params.temperature as number | undefined,
      maxHistoryLength: params.maxHistoryLength as number | undefined,
      metadata: params.metadata as Record<string, unknown> | undefined,
    });
    return result;
  }

  private handleSessionChat(params: Record<string, unknown>) {
    const { sessionId, message, options } = params as {
      sessionId: string;
      message: string;
      options?: ChatOptions;
    };

    const session = this.session.require(sessionId);

    this.session.addMessage(sessionId, {
      role: 'user',
      content: message,
    });

    const replyText = this.generateMockReply(message, session.systemPrompt);

    const reply = this.session.addMessage(sessionId, {
      role: 'assistant',
      content: replyText,
      tokens: replyText.length,
    });

    return {
      message: reply,
      usage: {
        inputTokens: message.length,
        outputTokens: replyText.length,
        totalTokens: message.length + replyText.length,
      },
      model: session.model || 'default-model',
    };
  }

  private handleSessionHistory(params: Record<string, unknown>) {
    const { sessionId, limit } = params as { sessionId: string; limit?: number };
    return this.session.getHistory(sessionId, limit);
  }

  private handleSessionClear(params: Record<string, unknown>) {
    const { sessionId } = params as { sessionId: string };
    this.session.clearHistory(sessionId);
    return { cleared: true };
  }

  private handlePromptFill(params: Record<string, unknown>) {
    const { content, variables, options } = params as {
      content: string;
      variables: Record<string, string | number | boolean>;
      options?: { strict?: boolean };
    };
    return this.prompt.fill(content, variables, options);
  }

  private handlePromptTemplateList(params: Record<string, unknown>) {
    return this.prompt.listTemplates(params);
  }

  private handlePromptTemplateCreate(params: Record<string, unknown>) {
    return this.prompt.createTemplate(params as Parameters<PromptManager['createTemplate']>[0]);
  }

  private handlePromptTemplateGet(params: Record<string, unknown>) {
    const { id } = params as { id: string };
    return this.prompt.requireTemplate(id);
  }

  private handlePromptTemplateUpdate(params: Record<string, unknown>) {
    const { id, ...updates } = params as { id: string } & Partial<Omit<PromptTemplate, 'id' | 'createdAt'>>;
    return this.prompt.updateTemplate(id, updates);
  }

  private handlePromptTemplateDelete(params: Record<string, unknown>) {
    const { id } = params as { id: string };
    const deleted = this.prompt.deleteTemplate(id);
    return { deleted };
  }

  private handleDocumentSummarize(params: Record<string, unknown>): SummaryResult {
    const { content, documentId, ...options } = params as {
      content?: string;
      documentId?: string;
      maxLength?: number;
      ratio?: number;
    };

    if (documentId) {
      return this.document.summarizeDocument(documentId, options);
    }

    if (!content) {
      throw new Error('Either content or documentId must be provided');
    }

    return this.document.summarize(content, options);
  }

  private handleDocumentExtractKeyPoints(params: Record<string, unknown>): KeyPointsResult {
    const { content, documentId, ...options } = params as {
      content?: string;
      documentId?: string;
      maxPoints?: number;
      minLength?: number;
    };

    if (documentId) {
      return this.document.extractKeyPointsDocument(documentId, options);
    }

    if (!content) {
      throw new Error('Either content or documentId must be provided');
    }

    return this.document.extractKeyPoints(content, options);
  }

  private handleDocumentClassify(params: Record<string, unknown>): ClassificationResult {
    const { content, documentId, categories } = params as {
      content?: string;
      documentId?: string;
      categories?: string[];
    };

    if (documentId) {
      return this.document.classifyDocument(documentId, categories);
    }

    if (!content) {
      throw new Error('Either content or documentId must be provided');
    }

    return this.document.classify(content, categories);
  }

  private handleDocumentSensitiveCheck(params: Record<string, unknown>): SensitiveCheckResult {
    const { content, documentId } = params as {
      content?: string;
      documentId?: string;
    };

    if (documentId) {
      return this.document.sensitiveCheckDocument(documentId);
    }

    if (!content) {
      throw new Error('Either content or documentId must be provided');
    }

    return this.document.sensitiveCheck(content);
  }

  private handleImageDescribe(params: Record<string, unknown>): ImageDescriptionResult {
    const { imageId, url, base64, ...options } = params as {
      imageId?: string;
      url?: string;
      base64?: string;
      language?: string;
      detailLevel?: 'low' | 'medium' | 'high';
    };

    if (imageId) {
      return this.image.describe(imageId, options);
    }

    if (url || base64) {
      return this.image.describe({ url, base64 }, options);
    }

    throw new Error('Either imageId, url, or base64 must be provided');
  }

  private handleImageCompare(params: Record<string, unknown>): ImageCompareResult {
    const { image1, image2, ...options } = params as {
      image1: string;
      image2: string;
      threshold?: number;
      method?: 'structural' | 'feature' | 'hybrid';
    };

    return this.image.compare(image1, image2, options);
  }

  private handleTaskSubmit(params: Record<string, unknown>): Task {
    const { type, taskParams, userId, ...options } = params as {
      type: TaskType;
      taskParams: Record<string, unknown>;
      userId: string;
    } & TaskSubmitOptions;

    return this.task.submit(type, taskParams, userId, options);
  }

  private handleTaskStatus(params: Record<string, unknown>) {
    const { taskId } = params as { taskId: string };
    return this.task.getStatus(taskId);
  }

  private handleTaskResult(params: Record<string, unknown>) {
    const { taskId } = params as { taskId: string };
    return this.task.getResult(taskId);
  }

  private handleTaskList(params: Record<string, unknown>) {
    return this.task.list(params as Parameters<TaskManager['list']>[0]);
  }

  private handleTaskCancel(params: Record<string, unknown>) {
    const { taskId } = params as { taskId: string };
    const cancelled = this.task.cancel(taskId);
    return { cancelled };
  }

  private handleAuditLogList(params: Record<string, unknown>): PaginationResult<AuditLogEntry> {
    return this.audit.list(params as PaginationParams & {
      userId?: string;
      module?: ModuleType;
      operation?: OperationType;
      success?: boolean;
    });
  }

  private handleAuditLogGet(params: Record<string, unknown>) {
    const { id } = params as { id: string };
    const log = this.audit.get(id);
    if (!log) {
      throw new Error(`Audit log ${id} not found`);
    }
    return log;
  }

  private handleConfigGet(params: Record<string, unknown>) {
    const { key } = params as { key: string };
    return { key, value: this.config.getCustom(key) };
  }

  private handleConfigSet(params: Record<string, unknown>) {
    const { key, value } = params as { key: string; value: unknown };
    this.config.setCustom(key, value);
    return { key, value };
  }

  private handleConfigList(params: Record<string, unknown>) {
    return this.config.listCustom();
  }

  private handleUsageStats(params: Record<string, unknown>) {
    return this.usage.getStats(params as Parameters<UsageManager['getStats']>[0]);
  }

  private generateMockReply(message: string, systemPrompt?: string): string {
    const seed = message.length;
    const replies = [
      `好的，我来帮你分析这个问题。关于"${message.substring(0, Math.min(20, message.length))}..."，我的看法是这样的...`,
      `这是一个很好的问题！关于你提到的内容，让我从几个角度来分析一下...`,
      `我理解你的意思。基于你提供的信息，我给出以下建议：首先...其次...最后...`,
      `收到你的消息了！这个话题很有意思，让我来详细回答一下...`,
      `好的，我来处理这个请求。根据我的分析，你需要的是...`,
    ];

    let reply = replies[seed % replies.length];

    if (systemPrompt) {
      reply = `【系统提示】${reply}`;
    }

    return reply;
  }
}
