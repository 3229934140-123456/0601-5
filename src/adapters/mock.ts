import {
  BaseAIServiceAdapter,
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
  AIServiceConfig,
} from './base';
import { sleep } from '../utils';

export class MockTextAIService extends BaseAIServiceAdapter {
  private delay: number;

  constructor(config: Partial<AIServiceConfig> = {}) {
    super({
      type: 'text',
      provider: 'mock',
      model: config.model || 'mock-text-v1',
      timeout: config.timeout || 30000,
      ...config,
    });
    this.delay = (config.extraParams?.delay as number) || 100;
  }

  supports(operation: string): boolean {
    return ['session.chat', 'text.generate'].includes(operation);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    await sleep(this.delay);

    const lastUserMessage = [...request.messages].reverse().find((m) => m.role === 'user');
    const userContent = lastUserMessage?.content || '';
    const systemMessage = request.messages.find((m) => m.role === 'system');

    const replies = [
      `好的，我来帮你分析这个问题。关于"${userContent.substring(0, Math.min(20, userContent.length))}..."，我的看法是这样的：首先需要明确问题的核心，然后从多个角度进行分析，最后给出可行的解决方案。`,
      `这是一个很好的问题！关于你提到的内容，让我从几个角度来分析一下：第一，从技术层面来看...；第二，从业务层面来看...；第三，从用户体验层面来看...。`,
      `我理解你的意思。基于你提供的信息，我给出以下建议：首先，要明确目标和范围；其次，制定详细的执行计划；最后，逐步推进并及时调整。`,
      `收到你的消息了！这个话题很有意思，让我来详细回答一下。首先，我们需要了解背景信息；其次，分析当前的现状；最后，提出改进的方案。`,
      `好的，我来处理这个请求。根据我的分析，你需要的是一个综合性的解决方案。让我为你详细阐述一下具体的思路和步骤。`,
    ];

    const seed = userContent.length;
    let reply = replies[seed % replies.length];

    if (systemMessage) {
      reply = `【系统提示已应用】${reply}`;
    }

    const inputTokens = request.messages.reduce((sum, m) => sum + m.content.length, 0);
    const outputTokens = reply.length;

    return {
      content: reply,
      model: this.config.model || 'mock-text-v1',
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      finishReason: 'stop',
    };
  }
}

export class MockImageAIService extends BaseAIServiceAdapter {
  private delay: number;

  constructor(config: Partial<AIServiceConfig> = {}) {
    super({
      type: 'image',
      provider: 'mock',
      model: config.model || 'mock-image-v1',
      timeout: config.timeout || 30000,
      ...config,
    });
    this.delay = (config.extraParams?.delay as number) || 150;
  }

  supports(operation: string): boolean {
    return ['image.describe', 'image.compare'].includes(operation);
  }

  async describe(request: ImageDescribeRequest): Promise<ImageDescribeResponse> {
    await sleep(this.delay);

    const seed = this.simpleHash(request.imageUrl || request.imageBase64 || 'default');

    const descriptionsByLevel: Record<string, string[]> = {
      low: ['一张风景照片', '人物肖像照片', '产品展示图片', '室内场景照片', '自然风光图片'],
      medium: [
        '一张风景优美的户外照片，天空湛蓝，远处有山脉',
        '一位面带微笑的人物肖像，背景虚化，构图精美',
        '一张产品展示图，背景干净，主体突出',
        '室内场景照片，光线柔和，布置温馨',
        '自然风光图片，绿意盎然，生机勃勃',
      ],
      high: [
        '一张专业拍摄的风景照片，前景有绿色植被，中景是平静的湖面，远处是连绵的山脉，天空中有白云点缀，构图采用三分法，色彩鲜艳，光线柔和',
        '人物肖像照，人物位于画面中央偏右位置，采用大光圈拍摄，背景虚化效果明显，人物表情自然，服装搭配协调，整体色调温暖',
        '产品摄影图片，白色背景，产品位于画面中央，多角度展示细节，光线均匀，质感表现良好',
        '室内空间摄影，展现了一个现代化的室内场景，家具摆放有序，灯光设计合理，空间感强烈',
        '自然风光摄影，展现了大自然的壮美景色，前景有树木，中景有草地，远景是山脉，层次分明，色彩丰富',
      ],
    };

    const level = request.detailLevel || 'medium';
    const descriptions = descriptionsByLevel[level];
    const description = descriptions[seed % descriptions.length];

    const tagSets = [
      ['风景', '户外', '自然', '山脉', '天空', '旅行'],
      ['人物', '肖像', '微笑', '特写', '人像', '摄影'],
      ['产品', '展示', '商业', '广告', '静物', '电商'],
      ['室内', '家居', '建筑', '设计', '空间', '现代'],
      ['自然', '风景', '绿色', '生态', '环境', '森林'],
    ];
    const tags = tagSets[seed % tagSets.length];
    const categories = tags.slice(0, 2);

    const objectSets = [
      [
        { name: '山', confidence: 0.95 },
        { name: '天空', confidence: 0.98 },
        { name: '树', confidence: 0.87 },
      ],
      [
        { name: '人', confidence: 0.99 },
        { name: '脸', confidence: 0.96 },
        { name: '头发', confidence: 0.88 },
      ],
      [
        { name: '产品', confidence: 0.97 },
        { name: '包装盒', confidence: 0.82 },
      ],
    ];
    const objects = objectSets[seed % objectSets.length];

    return {
      description,
      tags,
      categories,
      confidence: 0.7 + (seed % 30) / 100,
      objects,
    };
  }

  async compare(request: ImageCompareRequest): Promise<ImageCompareResponse> {
    await sleep(this.delay);

    const img1 = request.image1Url || request.image1Base64 || 'img1';
    const img2 = request.image2Url || request.image2Base64 || 'img2';

    const hash1 = this.simpleHash(img1);
    const hash2 = this.simpleHash(img2);

    const diff = Math.abs(hash1 - hash2);
    const baseSimilarity = 1 - diff / 100000;

    let structuralSimilarity = Math.max(0, Math.min(1, baseSimilarity + 0.1));
    let colorSimilarity = Math.max(0, Math.min(1, baseSimilarity + 0.05));
    let featureSimilarity = Math.max(0, Math.min(1, baseSimilarity));

    let similarity: number;
    switch (request.method) {
      case 'structural':
        similarity = structuralSimilarity;
        break;
      case 'feature':
        similarity = featureSimilarity;
        break;
      case 'hybrid':
      default:
        similarity = structuralSimilarity * 0.3 + colorSimilarity * 0.3 + featureSimilarity * 0.4;
    }

    similarity = Math.max(0, Math.min(1, similarity));
    const threshold = 0.7;

    return {
      similarity,
      isSimilar: similarity >= threshold,
      threshold,
      details: {
        structuralSimilarity,
        colorSimilarity,
        featureSimilarity,
      },
    };
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
}

export class MockDocumentAIService extends BaseAIServiceAdapter {
  private delay: number;

  constructor(config: Partial<AIServiceConfig> = {}) {
    super({
      type: 'document',
      provider: 'mock',
      model: config.model || 'mock-doc-v1',
      timeout: config.timeout || 30000,
      ...config,
    });
    this.delay = (config.extraParams?.delay as number) || 120;
  }

  supports(operation: string): boolean {
    return [
      'document.summarize',
      'document.extractKeyPoints',
      'document.classify',
      'document.sensitiveCheck',
    ].includes(operation);
  }

  async summarize(request: DocumentSummarizeRequest): Promise<DocumentSummarizeResponse> {
    await sleep(this.delay);

    const { content, maxLength = 200, ratio = 0.3 } = request;
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
      summary += item.sentence + '。';
    }

    selected.sort((a, b) => a.index - b.index);
    summary = selected.map((s) => s.sentence).join('。') + '。';

    return {
      summary: summary.trim(),
      keyPoints: selected.slice(0, 5).map((s) => s.sentence),
      wordCount: this.countWords(summary),
      compressionRatio: summary.length / content.length,
    };
  }

  async extractKeyPoints(request: DocumentKeyPointsRequest): Promise<DocumentKeyPointsResponse> {
    await sleep(this.delay);

    const { content, maxPoints = 10 } = request;
    const sentences = this.splitSentences(content);
    const keyPoints: { id: string; text: string; confidence: number }[] = [];

    for (let i = 0; i < sentences.length && keyPoints.length < maxPoints; i++) {
      const sentence = sentences[i];
      if (sentence.length >= 10) {
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

  async classify(request: DocumentClassifyRequest): Promise<DocumentClassifyResponse> {
    await sleep(this.delay);

    const { content, categories } = request;
    const cats = categories || ['技术', '商业', '教育', '娱乐', '健康', '金融', '法律', '其他'];

    const keywordMap: Record<string, string[]> = {
      技术: ['代码', '编程', '软件', '系统', '算法', '数据', '网络', '服务器', 'API', '接口'],
      商业: ['市场', '营销', '销售', '客户', '产品', '盈利', '投资', '创业', '品牌', '公司'],
      教育: ['学习', '教学', '课程', '学生', '老师', '学校', '考试', '知识', '培训', '教育'],
      娱乐: ['电影', '音乐', '游戏', '明星', '综艺', '小说', '动漫', '体育', '娱乐'],
      健康: ['医疗', '健康', '疾病', '治疗', '药物', '运动', '饮食', '心理', '医院'],
      金融: ['股票', '基金', '投资', '理财', '银行', '保险', '经济', '货币', '金融'],
      法律: ['法律', '法院', '诉讼', '合同', '律师', '法规', '权益', '责任', '法律'],
    };

    const scores: { category: string; confidence: number }[] = [];

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

  async sensitiveCheck(request: SensitiveCheckRequest): Promise<SensitiveCheckResponse> {
    await sleep(this.delay);

    const { content } = request;
    const sensitiveWords: { word: string; category: string; severity: 'low' | 'medium' | 'high' }[] = [
      { word: '暴力', category: 'violence', severity: 'high' },
      { word: '血腥', category: 'violence', severity: 'high' },
      { word: '恐怖', category: 'violence', severity: 'medium' },
      { word: '打架', category: 'violence', severity: 'medium' },
      { word: '殴打', category: 'violence', severity: 'medium' },
      { word: '杀戮', category: 'violence', severity: 'high' },
      { word: '武器', category: 'violence', severity: 'medium' },
      { word: '炸药', category: 'violence', severity: 'high' },
      { word: '色情', category: 'pornography', severity: 'high' },
      { word: '黄色', category: 'pornography', severity: 'medium' },
      { word: '淫秽', category: 'pornography', severity: 'high' },
      { word: '性服务', category: 'pornography', severity: 'high' },
      { word: '裸聊', category: 'pornography', severity: 'high' },
      { word: '成人', category: 'pornography', severity: 'low' },
      { word: '加微信', category: 'advertising', severity: 'low' },
      { word: '加好友', category: 'advertising', severity: 'low' },
      { word: '扫码关注', category: 'advertising', severity: 'low' },
      { word: '点击链接', category: 'advertising', severity: 'low' },
      { word: '免费领取', category: 'advertising', severity: 'medium' },
      { word: '限时优惠', category: 'advertising', severity: 'low' },
      { word: '辱骂', category: 'harassment', severity: 'medium' },
      { word: '侮辱', category: 'harassment', severity: 'medium' },
      { word: '歧视', category: 'harassment', severity: 'medium' },
      { word: '人身攻击', category: 'harassment', severity: 'high' },
      { word: '威胁', category: 'harassment', severity: 'high' },
      { word: '恐吓', category: 'harassment', severity: 'high' },
    ];

    const hits: {
      word: string;
      position: number;
      category: string;
      severity: 'low' | 'medium' | 'high';
    }[] = [];

    for (const sw of sensitiveWords) {
      let position = content.indexOf(sw.word);
      while (position !== -1) {
        hits.push({
          word: sw.word,
          position,
          category: sw.category,
          severity: sw.severity,
        });
        position = content.indexOf(sw.word, position + 1);
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

  private splitSentences(text: string): string[] {
    return text
      .replace(/([。！？!?;；])/g, '$1|')
      .split('|')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
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
}
