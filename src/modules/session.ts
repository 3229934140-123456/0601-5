import { generateSessionId } from '../utils';

export type ChatRole = 'system' | 'user' | 'assistant' | 'function';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  tokens?: number;
  metadata?: Record<string, unknown>;
}

export interface Session {
  id: string;
  userId: string;
  title: string;
  messages: ChatMessage[];
  maxHistoryLength?: number;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  systemPrompt?: string;
}

export interface ChatResult {
  message: ChatMessage;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  model: string;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private defaultMaxHistoryLength = 50;

  create(params: {
    userId: string;
    title?: string;
    systemPrompt?: string;
    model?: string;
    temperature?: number;
    maxHistoryLength?: number;
    metadata?: Record<string, unknown>;
  }): Session {
    const id = generateSessionId();
    const now = Date.now();

    const session: Session = {
      id,
      userId: params.userId,
      title: params.title || '新会话',
      messages: [],
      maxHistoryLength: params.maxHistoryLength || this.defaultMaxHistoryLength,
      systemPrompt: params.systemPrompt,
      model: params.model,
      temperature: params.temperature,
      createdAt: now,
      updatedAt: now,
      metadata: params.metadata,
    };

    this.sessions.set(id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  require(id: string): Session {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session ${id} not found`);
    }
    return session;
  }

  listByUser(userId: string): Session[] {
    return Array.from(this.sessions.values())
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  updateTitle(id: string, title: string): Session {
    const session = this.require(id);
    session.title = title;
    session.updatedAt = Date.now();
    return session;
  }

  addMessage(sessionId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>): ChatMessage {
    const session = this.require(sessionId);
    const msg: ChatMessage = {
      ...message,
      id: 'msg_' + Math.random().toString(36).substring(2, 15),
      timestamp: Date.now(),
    };

    session.messages.push(msg);
    session.updatedAt = msg.timestamp;

    if (session.maxHistoryLength && session.messages.length > session.maxHistoryLength) {
      const removeCount = session.messages.length - session.maxHistoryLength;
      session.messages.splice(0, removeCount);
    }

    return msg;
  }

  getHistory(sessionId: string, limit?: number): ChatMessage[] {
    const session = this.require(sessionId);
    const messages = [...session.messages];
    if (limit && limit < messages.length) {
      return messages.slice(messages.length - limit);
    }
    return messages;
  }

  getContextMessages(sessionId: string, includeSystem: boolean = true): ChatMessage[] {
    const session = this.require(sessionId);
    const result: ChatMessage[] = [];

    if (includeSystem && session.systemPrompt) {
      result.push({
        id: 'system_prompt',
        role: 'system',
        content: session.systemPrompt,
        timestamp: session.createdAt,
      });
    }

    result.push(...session.messages);
    return result;
  }

  clearHistory(sessionId: string): void {
    const session = this.require(sessionId);
    session.messages = [];
    session.updatedAt = Date.now();
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }

  deleteByUser(userId: string): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        this.sessions.delete(session.id);
        count++;
      }
    }
    return count;
  }

  getCount(): number {
    return this.sessions.size;
  }

  getUserSessionCount(userId: string): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        count++;
      }
    }
    return count;
  }
}
