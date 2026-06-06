import { generateId, sleep } from '../utils';
import {
  AIServiceManager,
  DocumentSummarizeResponse,
  DocumentKeyPointsResponse,
  DocumentClassifyResponse,
  SensitiveCheckResponse,
  ImageDescribeResponse,
  ImageCompareResponse,
  ChatResponse,
} from '../adapters';

export type WorkflowStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';

export type StepType =
  | 'document.summarize'
  | 'document.extractKeyPoints'
  | 'document.classify'
  | 'document.sensitiveCheck'
  | 'image.describe'
  | 'image.compare'
  | 'session.chat'
  | 'condition'
  | 'transform'
  | 'custom';

export interface WorkflowStepInput {
  from?: string;
  path?: string;
  value?: unknown;
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: StepType;
  status: StepStatus;
  params: Record<string, unknown>;
  inputMapping?: Record<string, WorkflowStepInput>;
  outputPath?: string;
  dependsOn: string[];
  result?: unknown;
  usage?: {
    tokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    images?: number;
    documents?: number;
  };
  error?: {
    code: string | number;
    message: string;
    details?: Record<string, unknown>;
  };
  startedAt?: number;
  completedAt?: number;
  duration?: number;
  retries: number;
  maxRetries: number;
  onFailure?: 'continue' | 'stop' | 'retry';
}

export interface WorkflowStepDefinition {
  id?: string;
  name: string;
  type: StepType;
  params?: Record<string, unknown>;
  inputMapping?: Record<string, WorkflowStepInput>;
  outputPath?: string;
  dependsOn?: string[];
  maxRetries?: number;
  onFailure?: 'continue' | 'stop' | 'retry';
}

export interface WorkflowDefinition {
  id?: string;
  name: string;
  description?: string;
  steps: WorkflowStepDefinition[];
  initialParams?: Record<string, unknown>;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  status: WorkflowStatus;
  steps: WorkflowStep[];
  initialParams: Record<string, unknown>;
  results: Record<string, unknown>;
  currentStepIndex: number;
  progress: number;
  error?: {
    stepId?: string;
    code: string | number;
    message: string;
  };
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  duration?: number;
  userId?: string;
  tenantId?: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
  totalRetries: number;
}

export class WorkflowManager {
  private workflows: Map<string, Workflow> = new Map();
  private aiServiceManager: AIServiceManager;
  private maxConcurrent: number = 5;
  private runningCount: number = 0;
  private runningWorkflows: Set<string> = new Set();
  private callbacks: Map<string, (workflow: Workflow) => void> = new Map();

  constructor(aiServiceManager?: AIServiceManager) {
    this.aiServiceManager = aiServiceManager || new AIServiceManager();
  }

  setAIServiceManager(manager: AIServiceManager): void {
    this.aiServiceManager = manager;
  }

  create(definition: WorkflowDefinition, userId?: string, tenantId?: string): Workflow {
    const id = definition.id || generateId('wf_');
    const now = Date.now();

    const steps: WorkflowStep[] = definition.steps.map((stepDef, index) => ({
      id: stepDef.id || `step_${index}`,
      name: stepDef.name,
      type: stepDef.type,
      status: 'pending',
      params: stepDef.params || {},
      inputMapping: stepDef.inputMapping,
      outputPath: stepDef.outputPath,
      dependsOn: stepDef.dependsOn || (index > 0 ? [`step_${index - 1}`] : []),
      retries: 0,
      maxRetries: stepDef.maxRetries ?? 1,
      onFailure: stepDef.onFailure || 'stop',
    }));

    const workflow: Workflow = {
      id,
      name: definition.name,
      description: definition.description,
      status: 'idle',
      steps,
      initialParams: definition.initialParams || {},
      results: {},
      currentStepIndex: -1,
      progress: 0,
      createdAt: now,
      userId,
      tenantId,
      callbackUrl: definition.callbackUrl,
      metadata: definition.metadata,
      totalRetries: 0,
    };

    this.workflows.set(id, workflow);
    return workflow;
  }

  get(workflowId: string): Workflow | undefined {
    return this.workflows.get(workflowId);
  }

  require(workflowId: string): Workflow {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }
    return workflow;
  }

  async start(workflowId: string): Promise<Workflow> {
    const workflow = this.require(workflowId);

    if (workflow.status !== 'idle' && workflow.status !== 'failed' && workflow.status !== 'cancelled') {
      throw new Error(`Cannot start workflow in status: ${workflow.status}`);
    }

    if (workflow.status === 'idle') {
      workflow.status = 'running';
      workflow.startedAt = Date.now();
      workflow.currentStepIndex = 0;
    } else {
      workflow.status = 'running';
    }

    this.runningWorkflows.add(workflowId);

    process.nextTick(() => this.runWorkflow(workflowId));

    return workflow;
  }

  private async runWorkflow(workflowId: string): Promise<void> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return;

    try {
      while (workflow.status === 'running') {
        const nextStep = this.findNextRunnableStep(workflow);

        if (!nextStep) {
          const allCompleted = workflow.steps.every(
            (s) => s.status === 'completed' || s.status === 'skipped'
          );
          const hasFailed = workflow.steps.some((s) => s.status === 'failed');

          if (allCompleted) {
            workflow.status = 'completed';
            workflow.progress = 100;
            workflow.completedAt = Date.now();
            workflow.duration = workflow.completedAt - (workflow.startedAt || 0);
            break;
          } else if (hasFailed) {
            const failedStep = workflow.steps.find((s) => s.status === 'failed');
            workflow.status = 'failed';
            workflow.error = {
              stepId: failedStep?.id,
              code: failedStep?.error?.code || -1,
              message: failedStep?.error?.message || 'Workflow failed',
            };
            workflow.completedAt = Date.now();
            workflow.duration = workflow.completedAt - (workflow.startedAt || 0);
            break;
          } else {
            break;
          }
        }

        await this.executeStep(workflow, nextStep);
        this.updateProgress(workflow);
      }
    } catch (error) {
      workflow.status = 'failed';
      workflow.error = {
        code: -1,
        message: error instanceof Error ? error.message : String(error),
      };
      workflow.completedAt = Date.now();
      workflow.duration = workflow.completedAt - (workflow.startedAt || 0);
    } finally {
      this.runningWorkflows.delete(workflowId);
      this.invokeCallback(workflow);
    }
  }

  private findNextRunnableStep(workflow: Workflow): WorkflowStep | undefined {
    for (const step of workflow.steps) {
      if (step.status !== 'pending') continue;

      const dependenciesMet = step.dependsOn.every((depId) => {
        const depStep = workflow.steps.find((s) => s.id === depId);
        if (!depStep) return true;
        return depStep.status === 'completed' || depStep.status === 'skipped';
      });

      if (dependenciesMet) {
        return step;
      }
    }
    return undefined;
  }

  private async executeStep(workflow: Workflow, step: WorkflowStep): Promise<void> {
    step.status = 'running';
    step.startedAt = Date.now();

    const params = this.resolveStepParams(workflow, step);

    try {
      let result: unknown;

      switch (step.type) {
        case 'document.summarize':
          result = await this.executeDocumentSummarize(params);
          break;
        case 'document.extractKeyPoints':
          result = await this.executeExtractKeyPoints(params);
          break;
        case 'document.classify':
          result = await this.executeClassify(params);
          break;
        case 'document.sensitiveCheck':
          result = await this.executeSensitiveCheck(params);
          break;
        case 'image.describe':
          result = await this.executeImageDescribe(params);
          break;
        case 'image.compare':
          result = await this.executeImageCompare(params);
          break;
        case 'session.chat':
          result = await this.executeChat(params);
          break;
        case 'condition':
          result = this.executeCondition(params);
          break;
        case 'transform':
          result = this.executeTransform(params);
          break;
        case 'custom':
        default:
          result = { success: true, data: params };
      }

      step.result = result;
      step.usage = this.calculateStepUsage(step, result, params);
      step.status = 'completed';
      step.completedAt = Date.now();
      step.duration = step.completedAt - step.startedAt;

      if (step.outputPath) {
        this.setResultAtPath(workflow.results, step.outputPath, result);
      } else {
        workflow.results[step.id] = result;
      }
    } catch (error) {
      step.retries++;
      workflow.totalRetries++;

      if (step.retries < step.maxRetries && step.onFailure === 'retry') {
        step.status = 'pending';
        return;
      }

      step.status = 'failed';
      step.error = {
        code: (error as any)?.code || -1,
        message: error instanceof Error ? error.message : String(error),
        details: (error as any)?.details,
      };
      step.completedAt = Date.now();
      step.duration = step.completedAt - step.startedAt;

      if (step.onFailure === 'continue') {
        step.status = 'skipped';
      }
    }
  }

  private resolveStepParams(workflow: Workflow, step: WorkflowStep): Record<string, unknown> {
    const params: Record<string, unknown> = { ...step.params };

    if (step.inputMapping) {
      for (const [key, input] of Object.entries(step.inputMapping)) {
        if (input.value !== undefined) {
          params[key] = input.value;
        } else if (input.from) {
          const source = input.from === 'initial' ? workflow.initialParams : workflow.results[input.from];
          if (input.path && source && typeof source === 'object') {
            params[key] = this.getResultAtPath(source as Record<string, unknown>, input.path);
          } else {
            params[key] = source;
          }
        }
      }
    }

    return params;
  }

  private getResultAtPath(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  private setResultAtPath(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current: Record<string, unknown> = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }

  private async executeDocumentSummarize(params: Record<string, unknown>): Promise<DocumentSummarizeResponse> {
    const response = await this.aiServiceManager.summarizeDocument({
      content: params.content as string,
      maxLength: params.maxLength as number,
      ratio: params.ratio as number,
    });
    return response;
  }

  private async executeExtractKeyPoints(params: Record<string, unknown>): Promise<DocumentKeyPointsResponse> {
    const response = await this.aiServiceManager.extractKeyPoints({
      content: params.content as string,
      maxPoints: params.maxPoints as number,
    });
    return response;
  }

  private async executeClassify(params: Record<string, unknown>): Promise<DocumentClassifyResponse> {
    const response = await this.aiServiceManager.classifyDocument({
      content: params.content as string,
      categories: params.categories as string[],
    });
    return response;
  }

  private async executeSensitiveCheck(params: Record<string, unknown>): Promise<SensitiveCheckResponse> {
    const response = await this.aiServiceManager.sensitiveCheck({
      content: params.content as string,
    });
    return response;
  }

  private async executeImageDescribe(params: Record<string, unknown>): Promise<ImageDescribeResponse> {
    const response = await this.aiServiceManager.describeImage({
      imageUrl: params.imageUrl as string,
      imageBase64: params.imageBase64 as string,
      detailLevel: params.detailLevel as 'low' | 'medium' | 'high',
    });
    return response;
  }

  private async executeImageCompare(params: Record<string, unknown>): Promise<ImageCompareResponse> {
    const response = await this.aiServiceManager.compareImages({
      image1Url: params.image1 as string,
      image2Url: params.image2 as string,
      method: params.method as 'structural' | 'feature' | 'hybrid',
    });
    return response;
  }

  private async executeChat(params: Record<string, unknown>): Promise<ChatResponse> {
    const messages = params.messages as { role: string; content: string }[];
    const response = await this.aiServiceManager.chat({
      messages: messages as any,
      model: params.model as string,
      temperature: params.temperature as number,
    });
    return response;
  }

  private executeCondition(params: Record<string, unknown>): { passed: boolean; result: unknown } {
    const { condition, value, thenValue, elseValue } = params;
    let passed = false;

    if (typeof condition === 'function') {
      passed = condition(value);
    } else if (typeof condition === 'string') {
      passed = Boolean(value);
    } else {
      passed = !!value;
    }

    return {
      passed,
      result: passed ? thenValue : elseValue,
    };
  }

  private executeTransform(params: Record<string, unknown>): unknown {
    const { data, template } = params;

    if (template && typeof template === 'string' && data && typeof data === 'object') {
      let result = template;
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
      }
      return result;
    }

    return data;
  }

  private updateProgress(workflow: Workflow): void {
    const total = workflow.steps.length;
    if (total === 0) {
      workflow.progress = 0;
      return;
    }

    const completed = workflow.steps.filter(
      (s) => s.status === 'completed' || s.status === 'skipped'
    ).length;

    const running = workflow.steps.filter((s) => s.status === 'running').length;
    const progress = (completed / total) * 100 + (running / total) * 10;

    workflow.progress = Math.min(100, Math.round(progress));
  }

  getStep(workflowId: string, stepId: string): WorkflowStep | undefined {
    const workflow = this.require(workflowId);
    return workflow.steps.find((s) => s.id === stepId);
  }

  retryStep(workflowId: string, stepId: string): boolean {
    const workflow = this.require(workflowId);
    const step = workflow.steps.find((s) => s.id === stepId);

    if (!step) return false;
    if (step.status !== 'failed' && step.status !== 'skipped') return false;

    step.status = 'pending';
    step.error = undefined;
    step.result = undefined;
    step.startedAt = undefined;
    step.completedAt = undefined;
    step.duration = undefined;

    if (workflow.status === 'failed' || workflow.status === 'cancelled') {
      workflow.status = 'running';
      workflow.error = undefined;
      this.runningWorkflows.add(workflowId);
      process.nextTick(() => this.runWorkflow(workflowId));
    }

    return true;
  }

  retryFailedSteps(workflowId: string): number {
    const workflow = this.require(workflowId);
    let count = 0;

    for (const step of workflow.steps) {
      if (step.status === 'failed' || step.status === 'skipped') {
        step.status = 'pending';
        step.error = undefined;
        step.result = undefined;
        step.startedAt = undefined;
        step.completedAt = undefined;
        step.duration = undefined;
        count++;
      }
    }

    if (count > 0 && (workflow.status === 'failed' || workflow.status === 'cancelled')) {
      workflow.status = 'running';
      workflow.error = undefined;
      this.runningWorkflows.add(workflowId);
      process.nextTick(() => this.runWorkflow(workflowId));
    }

    return count;
  }

  cancel(workflowId: string): boolean {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return false;

    if (workflow.status === 'completed' || workflow.status === 'failed' || workflow.status === 'cancelled') {
      return false;
    }

    workflow.status = 'cancelled';
    workflow.completedAt = Date.now();
    workflow.duration = workflow.completedAt - (workflow.startedAt || 0);

    for (const step of workflow.steps) {
      if (step.status === 'pending' || step.status === 'running') {
        step.status = 'cancelled';
      }
    }

    return true;
  }

  pause(workflowId: string): boolean {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return false;

    if (workflow.status !== 'running') return false;

    workflow.status = 'paused';
    return true;
  }

  resume(workflowId: string): boolean {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return false;

    if (workflow.status !== 'paused') return false;

    workflow.status = 'running';
    this.runningWorkflows.add(workflowId);
    process.nextTick(() => this.runWorkflow(workflowId));

    return true;
  }

  list(options: {
    userId?: string;
    tenantId?: string;
    status?: WorkflowStatus;
    page?: number;
    pageSize?: number;
  } = {}): {
    items: Workflow[];
    total: number;
  } {
    let workflows = Array.from(this.workflows.values());

    if (options.userId) {
      workflows = workflows.filter((w) => w.userId === options.userId);
    }

    if (options.tenantId) {
      workflows = workflows.filter((w) => w.tenantId === options.tenantId);
    }

    if (options.status) {
      workflows = workflows.filter((w) => w.status === options.status);
    }

    workflows.sort((a, b) => b.createdAt - a.createdAt);

    const total = workflows.length;
    const page = options.page || 1;
    const pageSize = options.pageSize || 20;
    const start = (page - 1) * pageSize;

    return {
      items: workflows.slice(start, start + pageSize),
      total,
    };
  }

  onComplete(workflowId: string, callback: (workflow: Workflow) => void): void {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return;

    if (workflow.status === 'completed' || workflow.status === 'failed' || workflow.status === 'cancelled') {
      callback(workflow);
      return;
    }

    this.callbacks.set(workflowId, callback);
  }

  private invokeCallback(workflow: Workflow): void {
    const callback = this.callbacks.get(workflow.id);
    if (callback) {
      try {
        callback(workflow);
      } catch {
        // ignore
      }
      this.callbacks.delete(workflow.id);
    }
  }

  getUsage(workflowId: string): {
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    skippedSteps: number;
    totalDuration: number;
    totalRetries: number;
    totalTokens: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalImages: number;
    totalDocuments: number;
  } {
    const workflow = this.require(workflowId);

    let totalTokens = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalImages = 0;
    let totalDocuments = 0;

    for (const step of workflow.steps) {
      if (step.usage) {
        totalTokens += step.usage.tokens || 0;
        totalInputTokens += step.usage.inputTokens || 0;
        totalOutputTokens += step.usage.outputTokens || 0;
        totalImages += step.usage.images || 0;
        totalDocuments += step.usage.documents || 0;
      }
    }

    return {
      totalSteps: workflow.steps.length,
      completedSteps: workflow.steps.filter((s) => s.status === 'completed').length,
      failedSteps: workflow.steps.filter((s) => s.status === 'failed').length,
      skippedSteps: workflow.steps.filter((s) => s.status === 'skipped').length,
      totalDuration: workflow.duration || 0,
      totalRetries: workflow.totalRetries,
      totalTokens,
      totalInputTokens,
      totalOutputTokens,
      totalImages,
      totalDocuments,
    };
  }

  private calculateStepUsage(step: WorkflowStep, result: unknown, params: Record<string, unknown>): WorkflowStep['usage'] {
    const usage: NonNullable<WorkflowStep['usage']> = {
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      images: 0,
      documents: 0,
    };

    const resultObj = result as Record<string, unknown>;

    switch (step.type) {
      case 'document.summarize': {
        const content = (params.content as string) || (step.params.content as string) || '';
        const summary = (resultObj.summary as string) || '';
        usage.inputTokens = content.length;
        usage.outputTokens = summary.length;
        usage.tokens = usage.inputTokens + usage.outputTokens;
        usage.documents = 1;
        break;
      }
      case 'document.extractKeyPoints': {
        const content = (params.content as string) || (step.params.content as string) || '';
        const keyPoints = (resultObj.keyPoints as Array<{ text: string }>) || [];
        const outputLen = keyPoints.reduce((sum, kp) => sum + kp.text.length, 0);
        usage.inputTokens = content.length;
        usage.outputTokens = outputLen;
        usage.tokens = usage.inputTokens + usage.outputTokens;
        usage.documents = 1;
        break;
      }
      case 'document.classify': {
        const content = (params.content as string) || (step.params.content as string) || '';
        usage.inputTokens = content.length;
        usage.outputTokens = 20;
        usage.tokens = usage.inputTokens + usage.outputTokens;
        usage.documents = 1;
        break;
      }
      case 'document.sensitiveCheck': {
        const content = (params.content as string) || (step.params.content as string) || '';
        const hits = (resultObj.hits as Array<unknown>) || [];
        usage.inputTokens = content.length;
        usage.outputTokens = hits.length * 10;
        usage.tokens = usage.inputTokens + usage.outputTokens;
        usage.documents = 1;
        break;
      }
      case 'image.describe': {
        const description = (resultObj.description as string) || '';
        usage.inputTokens = 100;
        usage.outputTokens = description.length;
        usage.tokens = usage.inputTokens + usage.outputTokens;
        usage.images = 1;
        break;
      }
      case 'image.compare': {
        usage.inputTokens = 200;
        usage.outputTokens = 50;
        usage.tokens = 250;
        usage.images = 2;
        break;
      }
      case 'session.chat': {
        if (resultObj.usage && typeof resultObj.usage === 'object') {
          const u = resultObj.usage as Record<string, number>;
          usage.inputTokens = u.inputTokens || 0;
          usage.outputTokens = u.outputTokens || 0;
          usage.tokens = u.totalTokens || u.tokens || (usage.inputTokens + usage.outputTokens);
        }
        break;
      }
      default:
        break;
    }

    return usage;
  }

  setMaxConcurrent(max: number): void {
    this.maxConcurrent = max;
  }

  cleanOldWorkflows(beforeDate: number): number {
    let count = 0;
    for (const workflow of this.workflows.values()) {
      if (workflow.completedAt && workflow.completedAt < beforeDate) {
        this.workflows.delete(workflow.id);
        count++;
      }
    }
    return count;
  }
}
