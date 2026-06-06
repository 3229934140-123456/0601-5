export type AIServiceType = 'text' | 'image' | 'document' | 'workflow';

export interface AIServiceConfig {
  type: AIServiceType;
  provider: string;
  apiKey?: string;
  apiBaseUrl?: string;
  model?: string;
  timeout?: number;
  extraParams?: Record<string, unknown>;
}

export interface ChatMessageInput {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessageInput[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ChatResponse {
  content: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
}

export interface ImageDescribeRequest {
  imageUrl?: string;
  imageBase64?: string;
  prompt?: string;
  detailLevel?: 'low' | 'medium' | 'high';
  language?: string;
}

export interface ImageDescribeResponse {
  description: string;
  tags?: string[];
  categories?: string[];
  confidence?: number;
  objects?: {
    name: string;
    confidence: number;
  }[];
}

export interface ImageCompareRequest {
  image1Url?: string;
  image1Base64?: string;
  image2Url?: string;
  image2Base64?: string;
  method?: 'structural' | 'feature' | 'hybrid';
}

export interface ImageCompareResponse {
  similarity: number;
  isSimilar: boolean;
  threshold: number;
  details?: {
    structuralSimilarity?: number;
    colorSimilarity?: number;
    featureSimilarity?: number;
  };
}

export interface DocumentSummarizeRequest {
  content: string;
  maxLength?: number;
  ratio?: number;
  language?: string;
}

export interface DocumentSummarizeResponse {
  summary: string;
  keyPoints?: string[];
  wordCount: number;
  compressionRatio: number;
}

export interface DocumentKeyPointsRequest {
  content: string;
  maxPoints?: number;
}

export interface DocumentKeyPointsResponse {
  keyPoints: {
    id: string;
    text: string;
    confidence?: number;
    category?: string;
  }[];
  total: number;
}

export interface DocumentClassifyRequest {
  content: string;
  categories?: string[];
}

export interface DocumentClassifyResponse {
  category: string;
  confidence: number;
  subCategory?: string;
  allCategories?: { category: string; confidence: number }[];
}

export interface SensitiveCheckRequest {
  content: string;
  categories?: string[];
}

export interface SensitiveCheckResponse {
  hasSensitive: boolean;
  hits: {
    word: string;
    position: number;
    category: string;
    severity: 'low' | 'medium' | 'high';
  }[];
  totalHits: number;
  severityScore: number;
  sanitizedContent?: string;
}

export interface AIServiceError {
  code: string | number;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export abstract class BaseAIServiceAdapter {
  readonly type: AIServiceType;
  readonly provider: string;
  protected config: AIServiceConfig;

  constructor(config: AIServiceConfig) {
    this.type = config.type;
    this.provider = config.provider;
    this.config = config;
  }

  get name(): string {
    return `${this.provider}-${this.type}`;
  }

  abstract getSupportedModels(): string[];

  abstract supports(operation: string): boolean;

  isRetryable(error: AIServiceError): boolean {
    return error.retryable;
  }

  protected createError(
    code: string | number,
    message: string,
    retryable: boolean = false,
    details?: Record<string, unknown>
  ): AIServiceError {
    return { code, message, retryable, details };
  }
}

export interface ITextAIService {
  chat(request: ChatRequest): Promise<ChatResponse>;
}

export interface IImageAIService {
  describe(request: ImageDescribeRequest): Promise<ImageDescribeResponse>;
  compare(request: ImageCompareRequest): Promise<ImageCompareResponse>;
}

export interface IDocumentAIService {
  summarize(request: DocumentSummarizeRequest): Promise<DocumentSummarizeResponse>;
  extractKeyPoints(request: DocumentKeyPointsRequest): Promise<DocumentKeyPointsResponse>;
  classify(request: DocumentClassifyRequest): Promise<DocumentClassifyResponse>;
  sensitiveCheck(request: SensitiveCheckRequest): Promise<SensitiveCheckResponse>;
}

export type AIServiceAdapter = BaseAIServiceAdapter &
  Partial<ITextAIService> &
  Partial<IImageAIService> &
  Partial<IDocumentAIService>;
