import { generateTraceId } from '../utils';
import { ConfigManager } from '../core/config';
import { RetryUtil } from '../core/retry';
import { PermissionManager } from '../core/permission';
import { UsageManager } from '../core/usage';
import { AuditManager } from '../core/audit';
import { AIServiceManager } from '../adapters';
import { SessionManager, ChatMessage, ChatOptions } from '../modules/session';
import { PromptManager, FillPromptOptions, FillResult } from '../modules/prompt';
import {
  DocumentManager,
  SummaryResult,
  KeyPointsResult,
  ClassificationResult,
  SensitiveCheckResult,
} from '../modules/document';
import { ImageManager, ImageDescriptionResult, ImageCompareResult } from '../modules/image';
import { TaskManager, Task, TaskType, TaskSubmitOptions, TaskStatus } from '../modules/task';
import {
  WorkflowManager,
  Workflow,
  WorkflowDefinition,
  WorkflowStep,
  WorkflowStatus,
} from '../modules/workflow';
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
  readonly aiService: AIServiceManager;
  readonly session: SessionManager;
  readonly prompt: PromptManager;
  readonly document: DocumentManager;
  readonly image: ImageManager;
  readonly task: TaskManager;
  readonly workflow: WorkflowManager;

  private defaultPermissionContext?: PermissionContext;

  constructor(config: AIPlatformConfig) {
    this.config = new ConfigManager(config);
    this.config.validate();

    this.aiService = new AIServiceManager();
    this.aiService.setRetryConfig(
      config.maxRetries || 3,
      config.retryDelay || 1000
    );

    this.permission = new PermissionManager();
    this.usage = new UsageManager();
    this.audit = new AuditManager();
    this.session = new SessionManager();
    this.prompt = new PromptManager();
    this.document = new DocumentManager();
    this.image = new ImageManager();
    this.task = new TaskManager(this.aiService, this.image);
    this.workflow = new WorkflowManager(this.aiService, this.image);
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
    options: {
      tenantId?: string;
      success?: boolean;
      traceId?: string;
    } = {}
  ): void {
    this.usage.record(userId, module, operation, usage, {
      tenantId: options.tenantId,
      success: options.success ?? true,
      traceId: options.traceId,
    });
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
      const usage = this.extractUsage(operation, result, duration);

      const module = operation.split('.')[0] as ModuleType;
      this.recordUsage(permContext.userId, module, operation, usage, {
        tenantId: permContext.tenantId,
        success: true,
        traceId,
      });
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
      this.recordUsage(permContext.userId, module, operation, usage, {
        tenantId: permContext.tenantId,
        success: false,
        traceId,
      });
      this.recordAudit(traceId, permContext.userId, module, operation, params, false, code, usage, permContext.tenantId);

      return this.createResponse(false, code, message, undefined, traceId, usage);
    }
  }

  private extractUsage(
    operation: OperationType,
    result: unknown,
    duration: number
  ): UsageInfo {
    const usage: UsageInfo = {
      requests: 1,
      duration,
    };

    if (!result || typeof result !== 'object') {
      return usage;
    }

    const resultObj = result as Record<string, unknown>;

    if (resultObj.usage && typeof resultObj.usage === 'object') {
      const resultUsage = resultObj.usage as Record<string, unknown>;
      usage.inputTokens = resultUsage.inputTokens as number || 0;
      usage.outputTokens = resultUsage.outputTokens as number || 0;
      usage.tokens = resultUsage.tokens as number || (usage.inputTokens || 0) + (usage.outputTokens || 0);
      usage.images = resultUsage.images as number;
      usage.documents = resultUsage.documents as number;
    }

    if (operation.startsWith('document.')) {
      usage.documents = usage.documents || 1;
    } else if (operation === 'image.describe') {
      usage.images = usage.images || 1;
    } else if (operation === 'image.compare') {
      usage.images = usage.images || 2;
    } else if (operation === 'task.submit') {
      const task = resultObj as any;
      if (task.type) {
        if (task.type.startsWith('document.')) {
          usage.documents = 1;
        } else if (task.type === 'image.describe') {
          usage.images = 1;
        } else if (task.type === 'image.compare') {
          usage.images = 2;
        }
      }
    }

    return usage;
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
      case 'prompt.template.search':
        return this.handlePromptTemplateSearch(params);

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
      case 'task.retry':
        return this.handleTaskRetry(params);

      case 'workflow.create':
        return this.handleWorkflowCreate(params);
      case 'workflow.start':
        return this.handleWorkflowStart(params);
      case 'workflow.status':
        return this.handleWorkflowStatus(params);
      case 'workflow.step.get':
        return this.handleWorkflowStepGet(params);
      case 'workflow.step.retry':
        return this.handleWorkflowStepRetry(params);
      case 'workflow.retry':
        return this.handleWorkflowRetry(params);
      case 'workflow.cancel':
        return this.handleWorkflowCancel(params);
      case 'workflow.list':
        return this.handleWorkflowList(params);

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

  private async handleSessionChat(params: Record<string, unknown>) {
    const { sessionId, message, options } = params as {
      sessionId: string;
      message: string;
      options?: ChatOptions;
    };

    const session = this.session.require(sessionId);

    const historyMessages = this.session.getContextMessages(sessionId, false).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const chatMessages = [
      ...(session.systemPrompt
        ? [{ role: 'system' as const, content: session.systemPrompt }]
        : []),
      ...historyMessages,
      { role: 'user' as const, content: message },
    ];

    const chatResult = await this.aiService.chat({
      messages: chatMessages,
      model: options?.model || session.model,
      temperature: options?.temperature || session.temperature,
    });

    this.session.addMessage(sessionId, {
      role: 'user',
      content: message,
    });

    const reply = this.session.addMessage(sessionId, {
      role: 'assistant',
      content: chatResult.content,
      tokens: chatResult.usage.outputTokens,
    });

    return {
      message: reply,
      usage: chatResult.usage,
      model: chatResult.model,
      finishReason: chatResult.finishReason,
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

  private handlePromptFill(params: Record<string, unknown>): FillResult {
    const { content, variables, options } = params as {
      content: string;
      variables: Record<string, string | number | boolean | string[]>;
      options?: FillPromptOptions;
    };
    return this.prompt.fill(content, variables, options);
  }

  private handlePromptTemplateList(params: Record<string, unknown>) {
    return this.prompt.listTemplates(params as Parameters<PromptManager['listTemplates']>[0]);
  }

  private handlePromptTemplateCreate(params: Record<string, unknown>) {
    return this.prompt.createTemplate(params as Parameters<PromptManager['createTemplate']>[0]);
  }

  private handlePromptTemplateGet(params: Record<string, unknown>) {
    const { id } = params as { id: string };
    return this.prompt.requireTemplate(id);
  }

  private handlePromptTemplateUpdate(params: Record<string, unknown>) {
    const { id, ...updates } = params as { id: string } & Parameters<PromptManager['updateTemplate']>[1];
    return this.prompt.updateTemplate(id, updates);
  }

  private handlePromptTemplateDelete(params: Record<string, unknown>) {
    const { id } = params as { id: string };
    const deleted = this.prompt.deleteTemplate(id);
    return { deleted };
  }

  private handlePromptTemplateSearch(params: Record<string, unknown>) {
    const { keyword, limit } = params as { keyword: string; limit?: number };
    return this.prompt.search(keyword, limit);
  }

  private async handleDocumentSummarize(params: Record<string, unknown>): Promise<SummaryResult & { usage?: UsageInfo }> {
    const { content, documentId, ...options } = params as {
      content?: string;
      documentId?: string;
      maxLength?: number;
      ratio?: number;
    };

    let docContent = content;
    if (documentId) {
      const doc = this.document.requireDocument(documentId);
      docContent = doc.content;
    }

    if (!docContent) {
      throw new Error('Either content or documentId must be provided');
    }

    const response = await this.aiService.summarizeDocument({
      content: docContent,
      maxLength: options.maxLength,
      ratio: options.ratio,
    });

    return {
      ...response,
      usage: {
        inputTokens: docContent.length,
        outputTokens: response.summary.length,
        tokens: docContent.length + response.summary.length,
        documents: 1,
        requests: 1,
        duration: 0,
      },
    };
  }

  private async handleDocumentExtractKeyPoints(params: Record<string, unknown>): Promise<KeyPointsResult & { usage?: UsageInfo }> {
    const { content, documentId, ...options } = params as {
      content?: string;
      documentId?: string;
      maxPoints?: number;
    };

    let docContent = content;
    if (documentId) {
      const doc = this.document.requireDocument(documentId);
      docContent = doc.content;
    }

    if (!docContent) {
      throw new Error('Either content or documentId must be provided');
    }

    const response = await this.aiService.extractKeyPoints({
      content: docContent,
      maxPoints: options.maxPoints,
    });

    const outputTokens = response.keyPoints.reduce((sum, kp) => sum + kp.text.length, 0);

    return {
      ...response,
      usage: {
        inputTokens: docContent.length,
        outputTokens,
        tokens: docContent.length + outputTokens,
        documents: 1,
        requests: 1,
        duration: 0,
      },
    };
  }

  private async handleDocumentClassify(params: Record<string, unknown>): Promise<ClassificationResult & { usage?: UsageInfo }> {
    const { content, documentId, categories } = params as {
      content?: string;
      documentId?: string;
      categories?: string[];
    };

    let docContent = content;
    if (documentId) {
      const doc = this.document.requireDocument(documentId);
      docContent = doc.content;
    }

    if (!docContent) {
      throw new Error('Either content or documentId must be provided');
    }

    const response = await this.aiService.classifyDocument({
      content: docContent,
      categories,
    });

    return {
      ...response,
      usage: {
        inputTokens: docContent.length,
        outputTokens: 20,
        tokens: docContent.length + 20,
        documents: 1,
        requests: 1,
        duration: 0,
      },
    };
  }

  private async handleDocumentSensitiveCheck(params: Record<string, unknown>): Promise<SensitiveCheckResult & { usage?: UsageInfo }> {
    const { content, documentId } = params as {
      content?: string;
      documentId?: string;
    };

    let docContent = content;
    if (documentId) {
      const doc = this.document.requireDocument(documentId);
      docContent = doc.content;
    }

    if (!docContent) {
      throw new Error('Either content or documentId must be provided');
    }

    const response = await this.aiService.sensitiveCheck({
      content: docContent,
    });

    return {
      ...response,
      usage: {
        inputTokens: docContent.length,
        outputTokens: response.hits.length * 10,
        tokens: docContent.length + response.hits.length * 10,
        documents: 1,
        requests: 1,
        duration: 0,
      },
    };
  }

  private async handleImageDescribe(params: Record<string, unknown>): Promise<ImageDescriptionResult & { usage?: UsageInfo }> {
    const { imageId, url, base64, ...options } = params as {
      imageId?: string;
      url?: string;
      base64?: string;
      language?: string;
      detailLevel?: 'low' | 'medium' | 'high';
    };

    let imageUrl = url;
    let imageBase64 = base64;

    if (imageId) {
      const img = this.image.getImage(imageId);
      if (img) {
        imageUrl = img.url;
        imageBase64 = img.base64;
      }
    }

    if (!imageUrl && !imageBase64) {
      throw new Error('Either imageId, url, or base64 must be provided');
    }

    const response = await this.aiService.describeImage({
      imageUrl,
      imageBase64,
      detailLevel: options.detailLevel,
      language: options.language,
    });

    return {
      ...response,
      usage: {
        inputTokens: 100,
        outputTokens: response.description.length,
        tokens: 100 + response.description.length,
        images: 1,
        requests: 1,
        duration: 0,
      },
    };
  }

  private async handleImageCompare(params: Record<string, unknown>): Promise<ImageCompareResult & { usage?: UsageInfo }> {
    const { image1, image2, ...options } = params as {
      image1: string;
      image2: string;
      threshold?: number;
      method?: 'structural' | 'feature' | 'hybrid';
    };

    const response = await this.aiService.compareImages({
      image1Url: image1,
      image2Url: image2,
      method: options.method,
    });

    return {
      ...response,
      usage: {
        inputTokens: 200,
        outputTokens: 50,
        tokens: 250,
        images: 2,
        requests: 1,
        duration: 0,
      },
    };
  }

  private handleTaskSubmit(params: Record<string, unknown>): Task {
    const { type, taskParams, userId, ...options } = params as {
      type: TaskType;
      taskParams: Record<string, unknown>;
      userId: string;
      tenantId?: string;
    } & TaskSubmitOptions;

    const task = this.task.submit(type, taskParams, userId, options);

    this.task.onComplete(task.id, (completedTask) => {
      this.recordTaskUsage(completedTask);
    });

    return task;
  }

  private recordTaskUsage(task: Task): void {
    if (!task.usage) return;

    const module = task.type.split('.')[0] as ModuleType;
    const usage: UsageInfo = {
      requests: 1,
      duration: task.duration || 0,
      inputTokens: task.usage.inputTokens,
      outputTokens: task.usage.outputTokens,
      tokens: task.usage.tokens,
      images: task.usage.images,
      documents: task.usage.documents,
    };

    this.recordUsage(task.userId, module, task.type as OperationType, usage, {
      tenantId: task.tenantId,
      success: task.status === 'completed',
      traceId: task.id,
    });
  }

  private handleTaskStatus(params: Record<string, unknown>): TaskStatus {
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
    return this.task.cancel(taskId);
  }

  private handleTaskRetry(params: Record<string, unknown>) {
    const { taskId } = params as { taskId: string };
    return this.task.retry(taskId);
  }

  private handleWorkflowCreate(params: Record<string, unknown>): Workflow {
    const { definition, userId, tenantId } = params as {
      definition: WorkflowDefinition;
      userId?: string;
      tenantId?: string;
    };
    return this.workflow.create(definition, userId, tenantId);
  }

  private async handleWorkflowStart(params: Record<string, unknown>): Promise<Workflow> {
    const { workflowId } = params as { workflowId: string };
    const workflow = await this.workflow.start(workflowId);

    this.workflow.onComplete(workflowId, (completedWorkflow) => {
      this.recordWorkflowUsage(completedWorkflow);
    });

    return workflow;
  }

  private recordWorkflowUsage(workflow: Workflow): void {
    for (const step of workflow.steps) {
      if (step.status !== 'completed' || !step.usage) continue;

      const module = step.type.split('.')[0] as ModuleType;
      const usage: UsageInfo = {
        requests: 1,
        duration: step.duration || 0,
        inputTokens: step.usage.inputTokens,
        outputTokens: step.usage.outputTokens,
        tokens: step.usage.tokens,
        images: step.usage.images,
        documents: step.usage.documents,
      };

      this.recordUsage(
        workflow.userId || 'unknown',
        module,
        step.type as OperationType,
        usage,
        {
          tenantId: workflow.tenantId,
          success: step.status === 'completed',
          traceId: `${workflow.id}_${step.id}`,
        }
      );
    }
  }

  private handleWorkflowStatus(params: Record<string, unknown>): Workflow {
    const { workflowId } = params as { workflowId: string };
    return this.workflow.require(workflowId);
  }

  private handleWorkflowStepGet(params: Record<string, unknown>): WorkflowStep {
    const { workflowId, stepId } = params as { workflowId: string; stepId: string };
    const step = this.workflow.getStep(workflowId, stepId);
    if (!step) {
      throw new Error(`Step ${stepId} not found in workflow ${workflowId}`);
    }
    return step;
  }

  private handleWorkflowStepRetry(params: Record<string, unknown>) {
    const { workflowId, stepId } = params as { workflowId: string; stepId: string };
    const success = this.workflow.retryStep(workflowId, stepId);
    return { success, stepId };
  }

  private handleWorkflowRetry(params: Record<string, unknown>) {
    const { workflowId } = params as { workflowId: string };
    const retried = this.workflow.retryFailedSteps(workflowId);
    return { success: retried > 0, retriedSteps: retried };
  }

  private handleWorkflowCancel(params: Record<string, unknown>) {
    const { workflowId } = params as { workflowId: string };
    const success = this.workflow.cancel(workflowId);
    return { success, workflowId };
  }

  private handleWorkflowList(params: Record<string, unknown>) {
    return this.workflow.list(params as Parameters<WorkflowManager['list']>[0]);
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
}
