import { generateTaskId, sleep } from '../utils';
import {
  DocumentSummarizeRequest,
  DocumentSummarizeResponse,
  DocumentKeyPointsRequest,
  DocumentKeyPointsResponse,
  DocumentClassifyRequest,
  DocumentClassifyResponse,
  SensitiveCheckRequest,
  SensitiveCheckResponse,
  ImageDescribeRequest,
  ImageDescribeResponse,
  ImageCompareRequest,
  ImageCompareResponse,
  ChatRequest,
  ChatResponse,
  AIServiceManager,
} from '../adapters';

export type TaskStatus = 'pending' | 'queued' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled';

export type TaskType =
  | 'document.summarize'
  | 'document.extractKeyPoints'
  | 'document.classify'
  | 'document.sensitiveCheck'
  | 'image.describe'
  | 'image.compare'
  | 'session.chat'
  | 'custom';

export interface TaskError {
  code: string | number;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface Task<TResult = unknown> {
  id: string;
  type: TaskType;
  status: TaskStatus;
  userId: string;
  tenantId?: string;
  priority?: number;
  params: Record<string, unknown>;
  result?: TResult;
  error?: TaskError;
  progress: number;
  progressText?: string;
  usage?: {
    tokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    images?: number;
    documents?: number;
  };
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  cancelledAt?: number;
  duration?: number;
  queuePosition?: number;
  callbackUrl?: string;
  retries: number;
  maxRetries: number;
  metadata?: Record<string, unknown>;
}

export interface TaskSubmitOptions {
  priority?: number;
  callbackUrl?: string;
  maxRetries?: number;
  tenantId?: string;
  metadata?: Record<string, unknown>;
}

export type TaskHandler = (task: Task, onProgress?: (progress: number, text?: string) => void) => Promise<{
  result: unknown;
  usage?: Task['usage'];
}>;

const TERMINAL_STATUSES: TaskStatus[] = ['completed', 'failed', 'cancelled'];
const ACTIVE_STATUSES: TaskStatus[] = ['queued', 'running', 'cancelling'];

function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  const transitions: Record<TaskStatus, TaskStatus[]> = {
    pending: ['queued', 'cancelled'],
    queued: ['running', 'cancelled'],
    running: ['completed', 'failed', 'cancelling'],
    cancelling: ['cancelled', 'completed', 'failed'],
    completed: [],
    failed: ['queued'],
    cancelled: ['queued'],
  };
  return transitions[from].includes(to);
}

export class TaskManager {
  private tasks: Map<string, Task> = new Map();
  private queue: string[] = [];
  private handlers: Map<TaskType, TaskHandler> = new Map();
  private maxConcurrent: number = 3;
  private runningCount: number = 0;
  private callbacks: Map<string, (task: Task) => void> = new Map();
  private maxQueueSize: number = 1000;
  private aiServiceManager: AIServiceManager;

  constructor(aiServiceManager?: AIServiceManager) {
    this.aiServiceManager = aiServiceManager || new AIServiceManager();
    this.registerDefaultHandlers();
  }

  private registerDefaultHandlers(): void {
    this.registerHandler('document.summarize', async (task, onProgress) => {
      onProgress?.(10, '正在处理文档...');
      await sleep(80);

      onProgress?.(30, '正在分析内容...');
      const content = task.params.content as string;

      const request: DocumentSummarizeRequest = {
        content,
        maxLength: task.params.maxLength as number,
        ratio: task.params.ratio as number,
      };

      onProgress?.(60, '正在生成摘要...');
      const response = await this.aiServiceManager.summarizeDocument(request);

      onProgress?.(100, '摘要生成完成');

      return {
        result: response,
        usage: {
          inputTokens: content?.length || 0,
          outputTokens: response.summary.length,
          tokens: (content?.length || 0) + response.summary.length,
          documents: 1,
        },
      };
    });

    this.registerHandler('document.extractKeyPoints', async (task, onProgress) => {
      onProgress?.(10, '正在读取文档...');
      await sleep(50);

      onProgress?.(40, '正在分析要点...');
      const content = task.params.content as string;

      const request: DocumentKeyPointsRequest = {
        content,
        maxPoints: task.params.maxPoints as number,
      };

      onProgress?.(70, '正在提取要点...');
      const response = await this.aiServiceManager.extractKeyPoints(request);

      onProgress?.(100, '要点提取完成');

      return {
        result: response,
        usage: {
          inputTokens: content?.length || 0,
          outputTokens: response.keyPoints.reduce((sum, kp) => sum + kp.text.length, 0),
          tokens: (content?.length || 0) + response.keyPoints.reduce((sum, kp) => sum + kp.text.length, 0),
          documents: 1,
        },
      };
    });

    this.registerHandler('document.classify', async (task, onProgress) => {
      onProgress?.(20, '正在分析文档...');
      const content = task.params.content as string;

      const request: DocumentClassifyRequest = {
        content,
        categories: task.params.categories as string[],
      };

      onProgress?.(60, '正在分类...');
      const response = await this.aiServiceManager.classifyDocument(request);

      onProgress?.(100, '分类完成');

      return {
        result: response,
        usage: {
          inputTokens: content?.length || 0,
          outputTokens: 20,
          tokens: (content?.length || 0) + 20,
          documents: 1,
        },
      };
    });

    this.registerHandler('document.sensitiveCheck', async (task, onProgress) => {
      onProgress?.(20, '正在扫描内容...');
      const content = task.params.content as string;

      const request: SensitiveCheckRequest = {
        content,
      };

      onProgress?.(60, '正在检测敏感词...');
      const response = await this.aiServiceManager.sensitiveCheck(request);

      onProgress?.(100, '检测完成');

      return {
        result: response,
        usage: {
          inputTokens: content?.length || 0,
          outputTokens: response.hits.length * 10,
          tokens: (content?.length || 0) + response.hits.length * 10,
          documents: 1,
        },
      };
    });

    this.registerHandler('image.describe', async (task, onProgress) => {
      onProgress?.(10, '正在校验参数...');

      const { url, base64, imageId, imageUrl, imageBase64, detailLevel, language } = task.params;

      const finalImageUrl = url || imageUrl;
      const finalImageBase64 = base64 || imageBase64;

      if (!finalImageUrl && !finalImageBase64) {
        const err: any = new Error('Missing required parameter: either url or base64 must be provided');
        err.code = 'INVALID_PARAMS';
        err.retryable = false;
        err.details = { missingFields: ['url'] };
        throw err;
      }

      onProgress?.(20, '正在加载图片...');
      await sleep(60);

      onProgress?.(50, '正在分析图片...');
      const request: ImageDescribeRequest = {
        imageUrl: finalImageUrl as string,
        imageBase64: finalImageBase64 as string,
        detailLevel: detailLevel as 'low' | 'medium' | 'high',
        language: language as string,
      };

      onProgress?.(80, '正在生成描述...');
      const response = await this.aiServiceManager.describeImage(request);

      onProgress?.(100, '描述生成完成');

      return {
        result: response,
        usage: {
          inputTokens: 100,
          outputTokens: response.description.length,
          tokens: 100 + response.description.length,
          images: 1,
        },
      };
    });

    this.registerHandler('image.compare', async (task, onProgress) => {
      onProgress?.(20, '正在加载图片...');
      await sleep(60);

      onProgress?.(50, '正在比对特征...');
      const request: ImageCompareRequest = {
        image1Url: task.params.image1 as string,
        image2Url: task.params.image2 as string,
        method: task.params.method as 'structural' | 'feature' | 'hybrid',
      };

      onProgress?.(80, '正在计算相似度...');
      const response = await this.aiServiceManager.compareImages(request);

      onProgress?.(100, '比对完成');

      return {
        result: response,
        usage: {
          inputTokens: 200,
          outputTokens: 50,
          tokens: 250,
          images: 2,
        },
      };
    });

    this.registerHandler('session.chat', async (task, onProgress) => {
      onProgress?.(10, '正在校验参数...');

      const {
        message,
        messages,
        sessionId,
        systemPrompt,
        model,
        temperature,
        maxTokens,
      } = task.params;

      let chatMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

      if (systemPrompt) {
        chatMessages.push({ role: 'system', content: String(systemPrompt) });
      }

      if (messages && Array.isArray(messages) && messages.length > 0) {
        chatMessages = chatMessages.concat(
          messages.map((m: any) => ({
            role: m.role || 'user',
            content: String(m.content),
          }))
        );
      } else if (message) {
        chatMessages.push({ role: 'user', content: String(message) });
      } else {
        const err: any = new Error('Missing required parameter: either message or messages must be provided');
        err.code = 'INVALID_PARAMS';
        err.retryable = false;
        err.details = { missingFields: ['message'] };
        throw err;
      }

      if (chatMessages.length === 0 || !chatMessages.some(m => m.role === 'user')) {
        const err: any = new Error('At least one user message is required');
        err.code = 'INVALID_PARAMS';
        err.retryable = false;
        err.details = { missingFields: ['user message'] };
        throw err;
      }

      onProgress?.(30, '正在构建请求...');

      const request: ChatRequest = {
        messages: chatMessages,
        model: model as string | undefined,
        temperature: temperature as number | undefined,
        maxTokens: maxTokens as number | undefined,
      };

      onProgress?.(50, '正在生成回复...');
      const response = await this.aiServiceManager.chat(request);

      onProgress?.(90, '正在处理结果...');

      const reply = {
        role: 'assistant' as const,
        content: response.content,
        tokens: response.usage.outputTokens,
      };

      onProgress?.(100, '回复生成完成');

      return {
        result: {
          message: reply,
          reply,
          model: response.model,
          finishReason: response.finishReason,
          messages: [...chatMessages, reply],
          sessionId: sessionId || null,
        },
        usage: {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          tokens: response.usage.totalTokens,
        },
      };
    });
  }

  registerHandler(type: TaskType, handler: TaskHandler): void {
    this.handlers.set(type, handler);
  }

  setAIServiceManager(manager: AIServiceManager): void {
    this.aiServiceManager = manager;
  }

  submit(
    type: TaskType,
    params: Record<string, unknown>,
    userId: string,
    options: TaskSubmitOptions = {}
  ): Task {
    if (!this.handlers.has(type) && type !== 'custom') {
      throw new Error(`No handler registered for task type: ${type}`);
    }

    if (this.queue.length >= this.maxQueueSize) {
      throw new Error('Task queue is full');
    }

    const task: Task = {
      id: generateTaskId(),
      type,
      status: 'queued',
      userId,
      tenantId: options.tenantId,
      priority: options.priority || 0,
      params: { ...params },
      progress: 0,
      createdAt: Date.now(),
      callbackUrl: options.callbackUrl,
      retries: 0,
      maxRetries: options.maxRetries ?? 0,
      metadata: options.metadata,
    };

    this.tasks.set(task.id, task);
    this.addToQueue(task.id, options.priority || 0);

    process.nextTick(() => this.processQueue());

    return task;
  }

  private addToQueue(taskId: string, priority: number): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    let insertIndex = 0;
    for (let i = 0; i < this.queue.length; i++) {
      const queuedTask = this.tasks.get(this.queue[i]);
      if (queuedTask && (queuedTask.priority || 0) >= priority) {
        insertIndex = i + 1;
      } else {
        break;
      }
    }

    this.queue.splice(insertIndex, 0, taskId);
    this.updateQueuePositions();
  }

  private updateQueuePositions(): void {
    this.queue.forEach((taskId, index) => {
      const task = this.tasks.get(taskId);
      if (task) {
        task.queuePosition = index + 1;
      }
    });
  }

  private transitionStatus(taskId: string, newStatus: TaskStatus): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (!canTransition(task.status, newStatus)) {
      return false;
    }

    task.status = newStatus;

    if (newStatus === 'cancelled') {
      task.cancelledAt = Date.now();
      task.completedAt = task.cancelledAt;
      task.duration = task.startedAt ? task.cancelledAt - task.startedAt : 0;
    } else if (isTerminalStatus(newStatus)) {
      if (!task.completedAt) {
        task.completedAt = Date.now();
      }
      if (task.startedAt && !task.duration) {
        task.duration = task.completedAt - task.startedAt;
      }
    }

    return true;
  }

  private processQueue(): void {
    if (this.runningCount >= this.maxConcurrent) return;
    if (this.queue.length === 0) return;

    const taskId = this.queue.shift();
    if (!taskId) return;

    const task = this.tasks.get(taskId);
    if (!task) {
      this.processQueue();
      return;
    }

    if (task.status === 'cancelled') {
      this.updateQueuePositions();
      this.processQueue();
      return;
    }

    if (!this.transitionStatus(taskId, 'running')) {
      this.updateQueuePositions();
      this.processQueue();
      return;
    }

    task.startedAt = Date.now();
    task.queuePosition = undefined;
    this.runningCount++;

    this.updateQueuePositions();

    this.executeTask(task)
      .then(({ result, usage }) => {
        const currentTask = this.tasks.get(taskId)!;

        if (currentTask.status === 'cancelling') {
          this.transitionStatus(taskId, 'cancelled');
        } else {
          task.result = result;
          task.usage = usage;
          this.transitionStatus(taskId, 'completed');
        }

        this.invokeCallback(task);
      })
      .catch((error) => {
        const currentTask = this.tasks.get(taskId)!;

        if (currentTask.status === 'cancelling') {
          this.transitionStatus(taskId, 'cancelled');
        } else {
          task.error = this.normalizeError(error);
          this.transitionStatus(taskId, 'failed');
        }

        this.invokeCallback(task);
      })
      .finally(() => {
        this.runningCount--;
        this.processQueue();
      });
  }

  private normalizeError(error: unknown): TaskError {
    if (error && typeof error === 'object') {
      const err = error as Record<string, unknown>;
      return {
        code: err.code !== undefined ? (err.code as string | number) : -1,
        message: err.message ? String(err.message) : String(error),
        retryable: typeof err.retryable === 'boolean' ? err.retryable : false,
        details: err.details as Record<string, unknown> | undefined,
      };
    }

    return {
      code: -1,
      message: String(error),
      retryable: false,
    };
  }

  private async executeTask(task: Task): Promise<{ result: unknown; usage?: Task['usage'] }> {
    const handler = this.handlers.get(task.type);
    if (!handler) {
      throw new Error(`No handler for task type: ${task.type}`);
    }

    const onProgress = (progress: number, text?: string) => {
      const currentTask = this.tasks.get(task.id);
      if (currentTask && !isTerminalStatus(currentTask.status) && currentTask.status !== 'cancelling') {
        currentTask.progress = Math.max(0, Math.min(100, progress));
        if (text) currentTask.progressText = text;
      }
    };

    return await handler(task, onProgress);
  }

  private invokeCallback(task: Task): void {
    const callback = this.callbacks.get(task.id);
    if (callback) {
      try {
        callback(task);
      } catch {
        // ignore callback errors
      }
      this.callbacks.delete(task.id);
    }

    if (task.callbackUrl) {
      this.triggerWebhook(task).catch(() => {
        // ignore webhook errors
      });
    }
  }

  private async triggerWebhook(task: Task): Promise<void> {
    if (!task.callbackUrl) return;

    try {
      await fetch(task.callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task.id,
          status: task.status,
          result: task.result,
          error: task.error,
          usage: task.usage,
        }),
      });
    } catch {
      // webhook call failed
    }
  }

  get(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  require(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    return task;
  }

  getStatus(taskId: string): TaskStatus {
    return this.require(taskId).status;
  }

  getResult(taskId: string): {
    status: TaskStatus;
    result?: unknown;
    error?: TaskError;
    progress: number;
    progressText?: string;
    usage?: Task['usage'];
  } {
    const task = this.require(taskId);
    return {
      status: task.status,
      result: task.result,
      error: task.error,
      progress: task.progress,
      progressText: task.progressText,
      usage: task.usage,
    };
  }

  waitForCompletion(taskId: string, timeout?: number): Promise<Task> {
    return new Promise((resolve, reject) => {
      const task = this.tasks.get(taskId);
      if (!task) {
        reject(new Error(`Task ${taskId} not found`));
        return;
      }

      if (isTerminalStatus(task.status)) {
        resolve(task);
        return;
      }

      const startTime = Date.now();

      const checkInterval = setInterval(() => {
        const currentTask = this.tasks.get(taskId);
        if (!currentTask) {
          clearInterval(checkInterval);
          reject(new Error(`Task ${taskId} not found`));
          return;
        }

        if (isTerminalStatus(currentTask.status)) {
          clearInterval(checkInterval);
          resolve(currentTask);
          return;
        }

        if (timeout && Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          reject(new Error(`Task ${taskId} timed out`));
        }
      }, 100);
    });
  }

  list(options: {
    userId?: string;
    tenantId?: string;
    status?: TaskStatus;
    type?: TaskType;
    page?: number;
    pageSize?: number;
  } = {}): {
    items: Task[];
    total: number;
  } {
    let tasks = Array.from(this.tasks.values());

    if (options.userId) {
      tasks = tasks.filter((t) => t.userId === options.userId);
    }

    if (options.tenantId) {
      tasks = tasks.filter((t) => t.tenantId === options.tenantId);
    }

    if (options.status) {
      tasks = tasks.filter((t) => t.status === options.status);
    }

    if (options.type) {
      tasks = tasks.filter((t) => t.type === options.type);
    }

    tasks.sort((a, b) => b.createdAt - a.createdAt);

    const total = tasks.length;
    const page = options.page || 1;
    const pageSize = options.pageSize || 20;
    const start = (page - 1) * pageSize;

    return {
      items: tasks.slice(start, start + pageSize),
      total,
    };
  }

  cancel(taskId: string): { success: boolean; status: TaskStatus; message?: string } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, status: 'failed', message: 'Task not found' };
    }

    if (isTerminalStatus(task.status)) {
      return { success: false, status: task.status, message: `Task already ${task.status}` };
    }

    if (task.status === 'queued') {
      this.transitionStatus(taskId, 'cancelled');
      this.queue = this.queue.filter((id) => id !== taskId);
      this.updateQueuePositions();
      return { success: true, status: 'cancelled', message: 'Task cancelled from queue' };
    }

    if (task.status === 'running') {
      this.transitionStatus(taskId, 'cancelling');
      return { success: true, status: 'cancelling', message: 'Task cancellation requested' };
    }

    return { success: false, status: task.status, message: `Cannot cancel task in status: ${task.status}` };
  }

  retry(taskId: string): { success: boolean; status?: TaskStatus; message?: string } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, message: 'Task not found' };
    }

    if (task.status !== 'failed' && task.status !== 'cancelled') {
      return { success: false, status: task.status, message: 'Only failed or cancelled tasks can be retried' };
    }

    if (task.retries >= task.maxRetries) {
      return { success: false, status: task.status, message: 'Max retries exceeded' };
    }

    task.retries++;
    task.error = undefined;
    task.result = undefined;
    task.progress = 0;
    task.progressText = undefined;
    task.startedAt = undefined;
    task.completedAt = undefined;
    task.cancelledAt = undefined;
    task.duration = undefined;

    this.transitionStatus(taskId, 'queued');
    this.addToQueue(taskId, task.priority || 0);

    process.nextTick(() => this.processQueue());

    return { success: true, status: 'queued', message: 'Task requeued' };
  }

  updateProgress(taskId: string, progress: number, progressText?: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (isTerminalStatus(task.status) || task.status === 'cancelling') return;

    task.progress = Math.max(0, Math.min(100, progress));
    if (progressText) {
      task.progressText = progressText;
    }
  }

  onComplete(taskId: string, callback: (task: Task) => void): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    if (isTerminalStatus(task.status)) {
      callback(task);
      return;
    }

    this.callbacks.set(taskId, callback);
  }

  setMaxConcurrent(max: number): void {
    this.maxConcurrent = max;
    this.processQueue();
  }

  setMaxQueueSize(max: number): void {
    this.maxQueueSize = max;
  }

  getQueueStats(): {
    queued: number;
    running: number;
    cancelling: number;
    completed: number;
    failed: number;
    cancelled: number;
  } {
    const stats = {
      queued: 0,
      running: 0,
      cancelling: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const task of this.tasks.values()) {
      if (task.status in stats) {
        (stats as Record<string, number>)[task.status]++;
      }
    }

    stats.queued = this.queue.length;
    stats.running = this.runningCount;

    return stats;
  }

  cleanOldTasks(beforeDate: number): number {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.completedAt && task.completedAt < beforeDate) {
        this.tasks.delete(task.id);
        count++;
      }
    }
    return count;
  }
}
