import {
  AIServiceAdapter,
  AIServiceConfig,
  AIServiceType,
  ChatRequest,
  ChatResponse,
  ImageDescribeRequest,
  ImageDescribeResponse,
  ImageCompareRequest,
  ImageCompareResponse,
  DocumentSummarizeRequest,
  DocumentSummarizeResponse,
  DocumentKeyPointsRequest,
  DocumentKeyPointsResponse,
  DocumentClassifyRequest,
  DocumentClassifyResponse,
  SensitiveCheckRequest,
  SensitiveCheckResponse,
  AIServiceError,
} from './base';
import { MockTextAIService, MockImageAIService, MockDocumentAIService } from './mock';
import { RetryUtil } from '../core/retry';
import { sleep } from '../utils';

export class AIServiceManager {
  private adapters: Map<string, AIServiceAdapter> = new Map();
  private defaultAdapters: Map<AIServiceType, string> = new Map();
  private maxRetries: number = 3;
  private retryDelay: number = 1000;

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    const mockText = new MockTextAIService();
    const mockImage = new MockImageAIService();
    const mockDoc = new MockDocumentAIService();

    this.registerAdapter('mock-text', mockText);
    this.registerAdapter('mock-image', mockImage);
    this.registerAdapter('mock-document', mockDoc);

    this.setDefaultAdapter('text', 'mock-text');
    this.setDefaultAdapter('image', 'mock-image');
    this.setDefaultAdapter('document', 'mock-document');
  }

  registerAdapter(name: string, adapter: AIServiceAdapter): void {
    this.adapters.set(name, adapter);
  }

  setDefaultAdapter(type: AIServiceType, name: string): void {
    if (!this.adapters.has(name)) {
      throw new Error(`Adapter "${name}" not found`);
    }
    this.defaultAdapters.set(type, name);
  }

  getAdapter(name: string): AIServiceAdapter | undefined {
    return this.adapters.get(name);
  }

  getDefaultAdapter(type: AIServiceType): AIServiceAdapter | undefined {
    const name = this.defaultAdapters.get(type);
    if (!name) return undefined;
    return this.adapters.get(name);
  }

  getTextAdapter(): AIServiceAdapter {
    return this.requireAdapter('text');
  }

  getImageAdapter(): AIServiceAdapter {
    return this.requireAdapter('image');
  }

  getDocumentAdapter(): AIServiceAdapter {
    return this.requireAdapter('document');
  }

  requireAdapter(type: AIServiceType, name?: string): AIServiceAdapter {
    let adapter: AIServiceAdapter | undefined;

    if (name) {
      adapter = this.adapters.get(name);
      if (!adapter) {
        throw new Error(`Adapter "${name}" not found`);
      }
    } else {
      adapter = this.getDefaultAdapter(type);
      if (!adapter) {
        throw new Error(`No default adapter for type "${type}"`);
      }
    }

    return adapter;
  }

  setRetryConfig(maxRetries: number, retryDelay: number): void {
    this.maxRetries = maxRetries;
    this.retryDelay = retryDelay;
  }

  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    adapter: AIServiceAdapter
  ): Promise<T> {
    return RetryUtil.execute(fn, {
      maxRetries: this.maxRetries,
      delay: this.retryDelay,
      shouldRetry: (error) => {
        if (error && typeof error === 'object' && 'retryable' in error) {
          return (error as AIServiceError).retryable;
        }
        return RetryUtil.isRetryableError(error as Error);
      },
    });
  }

  async chat(
    request: ChatRequest,
    adapterName?: string
  ): Promise<ChatResponse> {
    const adapter = this.requireAdapter('text', adapterName);
    if (!('chat' in adapter) || typeof (adapter as any).chat !== 'function') {
      throw new Error(`Adapter does not support chat operation`);
    }

    return this.executeWithRetry(
      () => (adapter as any).chat(request),
      adapter
    );
  }

  async describeImage(
    request: ImageDescribeRequest,
    adapterName?: string
  ): Promise<ImageDescribeResponse> {
    const adapter = this.requireAdapter('image', adapterName);
    if (!('describe' in adapter) || typeof (adapter as any).describe !== 'function') {
      throw new Error(`Adapter does not support describe operation`);
    }

    return this.executeWithRetry(
      () => (adapter as any).describe(request),
      adapter
    );
  }

  async compareImages(
    request: ImageCompareRequest,
    adapterName?: string
  ): Promise<ImageCompareResponse> {
    const adapter = this.requireAdapter('image', adapterName);
    if (!('compare' in adapter) || typeof (adapter as any).compare !== 'function') {
      throw new Error(`Adapter does not support compare operation`);
    }

    return this.executeWithRetry(
      () => (adapter as any).compare(request),
      adapter
    );
  }

  async summarizeDocument(
    request: DocumentSummarizeRequest,
    adapterName?: string
  ): Promise<DocumentSummarizeResponse> {
    const adapter = this.requireAdapter('document', adapterName);
    if (!('summarize' in adapter) || typeof (adapter as any).summarize !== 'function') {
      throw new Error(`Adapter does not support summarize operation`);
    }

    return this.executeWithRetry(
      () => (adapter as any).summarize(request),
      adapter
    );
  }

  async extractKeyPoints(
    request: DocumentKeyPointsRequest,
    adapterName?: string
  ): Promise<DocumentKeyPointsResponse> {
    const adapter = this.requireAdapter('document', adapterName);
    if (!('extractKeyPoints' in adapter) || typeof (adapter as any).extractKeyPoints !== 'function') {
      throw new Error(`Adapter does not support extractKeyPoints operation`);
    }

    return this.executeWithRetry(
      () => (adapter as any).extractKeyPoints(request),
      adapter
    );
  }

  async classifyDocument(
    request: DocumentClassifyRequest,
    adapterName?: string
  ): Promise<DocumentClassifyResponse> {
    const adapter = this.requireAdapter('document', adapterName);
    if (!('classify' in adapter) || typeof (adapter as any).classify !== 'function') {
      throw new Error(`Adapter does not support classify operation`);
    }

    return this.executeWithRetry(
      () => (adapter as any).classify(request),
      adapter
    );
  }

  async sensitiveCheck(
    request: SensitiveCheckRequest,
    adapterName?: string
  ): Promise<SensitiveCheckResponse> {
    const adapter = this.requireAdapter('document', adapterName);
    if (!('sensitiveCheck' in adapter) || typeof (adapter as any).sensitiveCheck !== 'function') {
      throw new Error(`Adapter does not support sensitiveCheck operation`);
    }

    return this.executeWithRetry(
      () => (adapter as any).sensitiveCheck(request),
      adapter
    );
  }

  listAdapters(): { name: string; type: AIServiceType; provider: string }[] {
    const result: { name: string; type: AIServiceType; provider: string }[] = [];
    for (const [name, adapter] of this.adapters) {
      result.push({ name, type: adapter.type, provider: adapter.provider });
    }
    return result;
  }

  unregisterAdapter(name: string): boolean {
    const type = this.adapters.get(name)?.type;
    const deleted = this.adapters.delete(name);
    if (type && this.defaultAdapters.get(type) === name) {
      this.defaultAdapters.delete(type);
    }
    return deleted;
  }
}
