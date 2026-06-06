import { AIPlatformConfig } from '../types';

const DEFAULT_CONFIG: Partial<AIPlatformConfig> = {
  maxRetries: 3,
  retryDelay: 1000,
  timeout: 30000,
  apiBaseUrl: 'https://api.ai-platform.example.com',
};

export class ConfigManager {
  private config: AIPlatformConfig;
  private customConfig: Record<string, unknown> = {};

  constructor(config: AIPlatformConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config } as AIPlatformConfig;
  }

  get<K extends keyof AIPlatformConfig>(key: K): AIPlatformConfig[K] {
    return this.config[key];
  }

  set<K extends keyof AIPlatformConfig>(key: K, value: AIPlatformConfig[K]): void {
    this.config[key] = value;
  }

  getAll(): AIPlatformConfig {
    return { ...this.config };
  }

  getCustom(key: string): unknown {
    return this.customConfig[key];
  }

  setCustom(key: string, value: unknown): void {
    this.customConfig[key] = value;
  }

  listCustom(): Record<string, unknown> {
    return { ...this.customConfig };
  }

  validate(): boolean {
    if (!this.config.apiKey) {
      throw new Error('API key is required');
    }
    return true;
  }
}
