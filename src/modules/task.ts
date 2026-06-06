import { generateTaskId, sleep } from '../utils';

export type TaskStatus = 'pending' | 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type TaskType =
  | 'document.summarize'
  | 'document.extractKeyPoints'
  | 'document.classify'
  | 'document.sensitiveCheck'
  | 'image.describe'
  | 'image.compare'
  | 'session.chat'
  | 'custom';

export interface Task<TResult = unknown> {
  id: string;
  type: TaskType;
  status: TaskStatus;
  userId: string;
  priority?: number;
  params: Record<string, unknown>;
  result?: TResult;
  error?: string;
  progress: number;
  progressText?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  duration?: number;
  queuePosition?: number;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskSubmitOptions {
  priority?: number;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export type TaskHandler = (task: Task) => Promise<unknown>;

export class TaskManager {
  private tasks: Map<string, Task> = new Map();
  private queue: string[] = [];
  private handlers: Map<TaskType, TaskHandler> = new Map();
  private maxConcurrent: number = 3;
  private runningCount: number = 0;
  private callbacks: Map<string, (result: Task) => void> = new Map();
  private maxQueueSize: number = 1000;

  constructor() {
    this.registerDefaultHandlers();
  }

  private registerDefaultHandlers(): void {
    this.registerHandler('document.summarize', async (task) => {
      const content = task.params.content as string;
      const length = content?.length || 0;
      let progress = 0;

      for (let i = 0; i < 10; i++) {
        await sleep(50);
        progress += 10;
        this.updateProgress(task.id, progress, `处理中 ${progress}%`);
      }

      return {
        summary: content?.substring(0, Math.min(100, length)) + '...',
        wordCount: Math.floor(length / 5),
        compressionRatio: 0.3,
      };
    });

    this.registerHandler('image.describe', async (task) => {
      await sleep(200);
      return {
        description: '一张图片的描述',
        tags: ['图片', '示例'],
        confidence: 0.85,
      };
    });
  }

  registerHandler(type: TaskType, handler: TaskHandler): void {
    this.handlers.set(type, handler);
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
      priority: options.priority || 0,
      params: { ...params },
      progress: 0,
      createdAt: Date.now(),
      callbackUrl: options.callbackUrl,
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
      if (queuedTask && (queuedTask.priority || 0) > priority) {
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

    this.runningCount++;
    task.status = 'running';
    task.startedAt = Date.now();
    task.queuePosition = undefined;

    this.updateQueuePositions();

    this.executeTask(task)
      .then((result) => {
        task.status = 'completed';
        task.result = result;
        task.completedAt = Date.now();
        task.duration = task.completedAt - (task.startedAt || 0);
        task.progress = 100;
        task.progressText = '完成';

        this.invokeCallback(task);
      })
      .catch((error) => {
        task.status = 'failed';
        task.error = error.message || String(error);
        task.completedAt = Date.now();
        task.duration = task.completedAt - (task.startedAt || 0);

        this.invokeCallback(task);
      })
      .finally(() => {
        this.runningCount--;
        this.processQueue();
      });
  }

  private async executeTask(task: Task): Promise<unknown> {
    const handler = this.handlers.get(task.type);
    if (!handler) {
      throw new Error(`No handler for task type: ${task.type}`);
    }

    return await handler(task);
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
        }),
      });
    } catch {
      // webhook call failed, could add retry logic here
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
    error?: string;
    progress: number;
    progressText?: string;
  } {
    const task = this.require(taskId);
    return {
      status: task.status,
      result: task.result,
      error: task.error,
      progress: task.progress,
      progressText: task.progressText,
    };
  }

  waitForCompletion(taskId: string, timeout?: number): Promise<Task> {
    return new Promise((resolve, reject) => {
      const task = this.tasks.get(taskId);
      if (!task) {
        reject(new Error(`Task ${taskId} not found`));
        return;
      }

      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
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

        if (currentTask.status === 'completed' || currentTask.status === 'failed' || currentTask.status === 'cancelled') {
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

  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.status === 'queued' || task.status === 'pending') {
      task.status = 'cancelled';
      task.completedAt = Date.now();
      this.queue = this.queue.filter((id) => id !== taskId);
      this.updateQueuePositions();
      return true;
    }

    if (task.status === 'running') {
      task.status = 'cancelled';
      return true;
    }

    return false;
  }

  updateProgress(taskId: string, progress: number, progressText?: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.progress = Math.max(0, Math.min(100, progress));
    if (progressText) {
      task.progressText = progressText;
    }
  }

  onComplete(taskId: string, callback: (task: Task) => void): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
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
    completed: number;
    failed: number;
    cancelled: number;
  } {
    const stats = {
      queued: 0,
      running: 0,
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
