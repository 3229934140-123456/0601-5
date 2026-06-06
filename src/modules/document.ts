export interface Document {
  id: string;
  title: string;
  content: string;
  contentType: 'text' | 'markdown' | 'html' | 'pdf';
  language?: string;
  wordCount?: number;
  charCount?: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface SummaryResult {
  summary: string;
  keyPoints?: string[];
  wordCount: number;
  compressionRatio: number;
}

export interface KeyPoint {
  id: string;
  text: string;
  confidence?: number;
  category?: string;
}

export interface KeyPointsResult {
  keyPoints: KeyPoint[];
  total: number;
}

export interface ClassificationResult {
  category: string;
  confidence: number;
  subCategory?: string;
  allCategories?: { category: string; confidence: number }[];
}

export interface SensitiveWordHit {
  word: string;
  position: number;
  category: string;
  severity: 'low' | 'medium' | 'high';
}

export interface SensitiveCheckResult {
  hasSensitive: boolean;
  hits: SensitiveWordHit[];
  totalHits: number;
  severityScore: number;
  sanitizedContent?: string;
}

type SensitiveCategory = 'politics' | 'violence' | 'pornography' | 'advertising' | 'harassment';

export class DocumentManager {
  private documents: Map<string, Document> = new Map();
  private sensitiveWords: Map<SensitiveCategory, string[]> = new Map();
  private categories: string[] = ['技术', '商业', '教育', '娱乐', '健康', '金融', '法律', '其他'];

  constructor() {
    this.initSensitiveWords();
  }

  private initSensitiveWords(): void {
    this.sensitiveWords.set('violence', ['暴力', '血腥', '恐怖', '打架', '殴打', '杀戮', '武器', '炸药']);
    this.sensitiveWords.set('pornography', ['色情', '黄色', '淫秽', '性服务', '裸聊', '成人']);
    this.sensitiveWords.set('advertising', ['加微信', '加好友', '扫码关注', '点击链接', '免费领取', '限时优惠']);
    this.sensitiveWords.set('harassment', ['辱骂', '侮辱', '歧视', '人身攻击', '威胁', '恐吓']);
    this.sensitiveWords.set('politics', []);
  }

  addSensitiveWords(category: SensitiveCategory, words: string[]): void {
    const existing = this.sensitiveWords.get(category) || [];
    this.sensitiveWords.set(category, [...new Set([...existing, ...words])]);
  }

  removeSensitiveWords(category: SensitiveCategory, words: string[]): void {
    const existing = this.sensitiveWords.get(category) || [];
    this.sensitiveWords.set(
      category,
      existing.filter((w) => !words.includes(w))
    );
  }

  setCategories(categories: string[]): void {
    this.categories = categories;
  }

  createDocument(params: {
    title: string;
    content: string;
    contentType?: 'text' | 'markdown' | 'html' | 'pdf';
    language?: string;
    metadata?: Record<string, unknown>;
  }): Document {
    const id = 'doc_' + Math.random().toString(36).substring(2, 15);
    const now = Date.now();

    const doc: Document = {
      id,
      title: params.title,
      content: params.content,
      contentType: params.contentType || 'text',
      language: params.language,
      wordCount: this.countWords(params.content),
      charCount: params.content.length,
      metadata: params.metadata,
      createdAt: now,
      updatedAt: now,
    };

    this.documents.set(id, doc);
    return doc;
  }

  getDocument(id: string): Document | undefined {
    return this.documents.get(id);
  }

  requireDocument(id: string): Document {
    const doc = this.documents.get(id);
    if (!doc) {
      throw new Error(`Document ${id} not found`);
    }
    return doc;
  }

  updateDocument(id: string, updates: Partial<Omit<Document, 'id' | 'createdAt'>>): Document {
    const doc = this.requireDocument(id);
    Object.assign(doc, updates);
    doc.updatedAt = Date.now();
    if (updates.content) {
      doc.wordCount = this.countWords(updates.content);
      doc.charCount = updates.content.length;
    }
    return doc;
  }

  deleteDocument(id: string): boolean {
    return this.documents.delete(id);
  }

  summarize(
    content: string,
    options: {
      maxLength?: number;
      ratio?: number;
      language?: string;
    } = {}
  ): SummaryResult {
    const { maxLength = 200, ratio = 0.3 } = options;

    const sentences = this.splitSentences(content);
    const targetLength = Math.min(maxLength, Math.floor(content.length * ratio));

    if (sentences.length === 0) {
      return {
        summary: '',
        keyPoints: [],
        wordCount: 0,
        compressionRatio: 0,
      };
    }

    const scored = sentences.map((sentence, index) => ({
      sentence,
      index,
      score: this.scoreSentence(sentence, index, sentences.length),
    }));

    scored.sort((a, b) => b.score - a.score);

    let summary = '';
    const selected: typeof scored = [];

    for (const item of scored) {
      if (summary.length + item.sentence.length > targetLength && selected.length > 0) {
        break;
      }
      selected.push(item);
      summary += item.sentence + ' ';
    }

    selected.sort((a, b) => a.index - b.index);
    summary = selected.map((s) => s.sentence).join(' ');

    return {
      summary: summary.trim(),
      keyPoints: selected.slice(0, 5).map((s) => s.sentence),
      wordCount: this.countWords(summary),
      compressionRatio: summary.length / content.length,
    };
  }

  summarizeDocument(
    id: string,
    options?: Parameters<DocumentManager['summarize']>[1]
  ): SummaryResult {
    const doc = this.requireDocument(id);
    return this.summarize(doc.content, options);
  }

  extractKeyPoints(
    content: string,
    options: {
      maxPoints?: number;
      minLength?: number;
    } = {}
  ): KeyPointsResult {
    const { maxPoints = 10, minLength = 10 } = options;

    const sentences = this.splitSentences(content);
    const keyPoints: KeyPoint[] = [];

    for (let i = 0; i < sentences.length && keyPoints.length < maxPoints; i++) {
      const sentence = sentences[i];
      if (sentence.length >= minLength) {
        const isKeyPoint =
          /^(首先|其次|最后|第一|第二|第三|重要的是|关键在于|需要注意|总结来说)/.test(sentence) ||
          sentence.includes('：') ||
          sentence.includes(':') ||
          /^\d+[.、)]/.test(sentence.trim());

        if (isKeyPoint || i < 3 || i > sentences.length - 3) {
          keyPoints.push({
            id: 'kp_' + i,
            text: sentence.trim(),
            confidence: isKeyPoint ? 0.9 : 0.6,
          });
        }
      }
    }

    if (keyPoints.length === 0) {
      for (let i = 0; i < Math.min(5, sentences.length); i++) {
        keyPoints.push({
          id: 'kp_' + i,
          text: sentences[i].trim(),
          confidence: 0.5,
        });
      }
    }

    return {
      keyPoints,
      total: keyPoints.length,
    };
  }

  extractKeyPointsDocument(
    id: string,
    options?: Parameters<DocumentManager['extractKeyPoints']>[1]
  ): KeyPointsResult {
    const doc = this.requireDocument(id);
    return this.extractKeyPoints(doc.content, options);
  }

  classify(content: string, categories?: string[]): ClassificationResult {
    const cats = categories || this.categories;
    const scores: { category: string; confidence: number }[] = [];

    const keywordMap: Record<string, string[]> = {
      技术: ['代码', '编程', '软件', '系统', '算法', '数据', '网络', '服务器', 'API', '接口'],
      商业: ['市场', '营销', '销售', '客户', '产品', '盈利', '投资', '创业', '品牌'],
      教育: ['学习', '教学', '课程', '学生', '老师', '学校', '考试', '知识', '培训'],
      娱乐: ['电影', '音乐', '游戏', '明星', '综艺', '小说', '动漫', '体育'],
      健康: ['医疗', '健康', '疾病', '治疗', '药物', '运动', '饮食', '心理'],
      金融: ['股票', '基金', '投资', '理财', '银行', '保险', '经济', '货币'],
      法律: ['法律', '法院', '诉讼', '合同', '律师', '法规', '权益', '责任'],
    };

    for (const category of cats) {
      const keywords = keywordMap[category] || [];
      let score = 0;

      for (const keyword of keywords) {
        const regex = new RegExp(keyword, 'g');
        const matches = content.match(regex);
        if (matches) {
          score += matches.length;
        }
      }

      const baseConfidence = Math.min(score / 5, 1) * 0.7 + 0.1;
      scores.push({ category, confidence: baseConfidence });
    }

    scores.sort((a, b) => b.confidence - a.confidence);

    if (scores.length === 0 || scores[0].confidence < 0.15) {
      return {
        category: '其他',
        confidence: 0.5,
        allCategories: scores,
      };
    }

    return {
      category: scores[0].category,
      confidence: scores[0].confidence,
      allCategories: scores,
    };
  }

  classifyDocument(id: string, categories?: string[]): ClassificationResult {
    const doc = this.requireDocument(id);
    return this.classify(doc.content, categories);
  }

  sensitiveCheck(content: string): SensitiveCheckResult {
    const hits: SensitiveWordHit[] = [];

    for (const [category, words] of this.sensitiveWords) {
      for (const word of words) {
        let position = content.indexOf(word);
        while (position !== -1) {
          hits.push({
            word,
            position,
            category,
            severity: this.getSeverity(category, word),
          });
          position = content.indexOf(word, position + 1);
        }
      }
    }

    hits.sort((a, b) => a.position - b.position);

    const severityScore = hits.reduce((score, hit) => {
      const severityValue = hit.severity === 'high' ? 3 : hit.severity === 'medium' ? 2 : 1;
      return score + severityValue;
    }, 0);

    let sanitizedContent: string | undefined;
    if (hits.length > 0) {
      sanitizedContent = content;
      for (const hit of hits) {
        const replacement = '*'.repeat(hit.word.length);
        sanitizedContent = sanitizedContent.replace(hit.word, replacement);
      }
    }

    return {
      hasSensitive: hits.length > 0,
      hits,
      totalHits: hits.length,
      severityScore,
      sanitizedContent,
    };
  }

  sensitiveCheckDocument(id: string): SensitiveCheckResult {
    const doc = this.requireDocument(id);
    return this.sensitiveCheck(doc.content);
  }

  private splitSentences(text: string): string[] {
    const sentences = text
      .replace(/([。！？!?])/g, '$1|')
      .split('|')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return sentences;
  }

  private scoreSentence(sentence: string, index: number, total: number): number {
    let score = 0;

    if (index === 0) score += 3;
    if (index === 1) score += 2;
    if (index === total - 1) score += 2;
    if (index === total - 2) score += 1;

    const length = sentence.length;
    if (length > 20 && length < 100) score += 2;

    const keyWords = ['重要', '关键', '核心', '主要', '首先', '其次', '最后', '总结', '因此'];
    for (const kw of keyWords) {
      if (sentence.includes(kw)) score += 1;
    }

    if (/^\d+[.、)]/.test(sentence.trim())) score += 1;

    return score;
  }

  private countWords(text: string): number {
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    return chineseChars + englishWords;
  }

  private getSeverity(category: string, word: string): 'low' | 'medium' | 'high' {
    const highSeverity = new Set(['暴力', '血腥', '恐怖', '杀戮', '炸药', '色情', '淫秽', '威胁', '恐吓']);
    const mediumSeverity = new Set(['打架', '殴打', '武器', '黄色', '性服务', '裸聊', '成人', '辱骂', '侮辱', '歧视', '人身攻击']);

    if (highSeverity.has(word)) return 'high';
    if (mediumSeverity.has(word)) return 'medium';
    return 'low';
  }

  getStats(): {
    totalDocuments: number;
    totalCharacters: number;
    totalWords: number;
  } {
    let totalChars = 0;
    let totalWords = 0;

    for (const doc of this.documents.values()) {
      totalChars += doc.charCount || 0;
      totalWords += doc.wordCount || 0;
    }

    return {
      totalDocuments: this.documents.size,
      totalCharacters: totalChars,
      totalWords: totalWords,
    };
  }
}
