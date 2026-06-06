export interface ImageInfo {
  id: string;
  url?: string;
  base64?: string;
  filename?: string;
  mimeType: string;
  width?: number;
  height?: number;
  fileSize?: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface ImageDescriptionResult {
  description: string;
  tags?: string[];
  categories?: string[];
  confidence?: number;
  objectsDetected?: {
    name: string;
    confidence: number;
    boundingBox?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }[];
}

export interface ImageCompareResult {
  similarity: number;
  isSimilar: boolean;
  threshold: number;
  details?: {
    structuralSimilarity?: number;
    colorSimilarity?: number;
    featureSimilarity?: number;
  };
}

export class ImageManager {
  private images: Map<string, ImageInfo> = new Map();
  private defaultSimilarityThreshold = 0.7;

  uploadImage(params: {
    url?: string;
    base64?: string;
    filename?: string;
    mimeType?: string;
    width?: number;
    height?: number;
    fileSize?: number;
    metadata?: Record<string, unknown>;
  }): ImageInfo {
    if (!params.url && !params.base64) {
      throw new Error('Either url or base64 must be provided');
    }

    const id = 'img_' + Math.random().toString(36).substring(2, 15);

    let mimeType = params.mimeType;
    if (!mimeType) {
      if (params.base64) {
        const match = params.base64.match(/^data:(.+?);base64,/);
        if (match) {
          mimeType = match[1];
        }
      } else if (params.url) {
        const ext = params.url.split('.').pop()?.toLowerCase();
        if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
        else if (ext === 'png') mimeType = 'image/png';
        else if (ext === 'gif') mimeType = 'image/gif';
        else if (ext === 'webp') mimeType = 'image/webp';
        else mimeType = 'image/png';
      }
    }

    const image: ImageInfo = {
      id,
      url: params.url,
      base64: params.base64,
      filename: params.filename,
      mimeType: mimeType || 'image/png',
      width: params.width,
      height: params.height,
      fileSize: params.fileSize,
      metadata: params.metadata,
      createdAt: Date.now(),
    };

    this.images.set(id, image);
    return image;
  }

  getImage(id: string): ImageInfo | undefined {
    return this.images.get(id);
  }

  deleteImage(id: string): boolean {
    return this.images.delete(id);
  }

  describe(
    imageInput: string | { imageId?: string; url?: string; base64?: string },
    options: {
      language?: string;
      detailLevel?: 'low' | 'medium' | 'high';
      includeTags?: boolean;
      includeObjects?: boolean;
    } = {}
  ): ImageDescriptionResult {
    const { language = 'zh-CN', detailLevel = 'medium', includeTags = true, includeObjects = true } = options;

    let imageInfo: ImageInfo | undefined;
    let imageId: string | undefined;

    if (typeof imageInput === 'string') {
      imageId = imageInput;
      imageInfo = this.images.get(imageInput);
    } else {
      if (imageInput.imageId) {
        imageId = imageInput.imageId;
        imageInfo = this.images.get(imageInput.imageId);
      }
    }

    const seed = this.simpleHash(imageId || JSON.stringify(imageInput));

    const descriptionsByLevel: Record<string, string[]> = {
      low: [
        '一张风景照片',
        '人物肖像照片',
        '产品展示图片',
        '室内场景照片',
        '自然风光图片',
      ],
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

    const descriptions = descriptionsByLevel[detailLevel];
    const description = descriptions[seed % descriptions.length];

    const result: ImageDescriptionResult = {
      description,
      confidence: 0.7 + (seed % 30) / 100,
    };

    if (includeTags) {
      const tagSets = [
        ['风景', '户外', '自然', '山脉', '天空'],
        ['人物', '肖像', '微笑', '特写', '人像'],
        ['产品', '展示', '商业', '广告', '静物'],
        ['室内', '家居', '建筑', '设计', '空间'],
        ['自然', '风景', '绿色', '生态', '环境'],
      ];
      result.tags = tagSets[seed % tagSets.length];
      result.categories = result.tags.slice(0, 2);
    }

    if (includeObjects) {
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
      result.objectsDetected = objectSets[seed % objectSets.length];
    }

    return result;
  }

  compare(
    image1: string | { imageId?: string; url?: string; base64?: string },
    image2: string | { imageId?: string; url?: string; base64?: string },
    options: {
      threshold?: number;
      method?: 'structural' | 'feature' | 'hybrid';
    } = {}
  ): ImageCompareResult {
    const { threshold = this.defaultSimilarityThreshold, method = 'hybrid' } = options;

    let id1: string;
    let id2: string;

    if (typeof image1 === 'string') id1 = image1;
    else id1 = image1.imageId || JSON.stringify(image1);

    if (typeof image2 === 'string') id2 = image2;
    else id2 = image2.imageId || JSON.stringify(image2);

    const hash1 = this.simpleHash(id1);
    const hash2 = this.simpleHash(id2);

    const diff = Math.abs(hash1 - hash2);
    const baseSimilarity = 1 - diff / 100000;

    let structuralSimilarity = Math.max(0, Math.min(1, baseSimilarity + 0.1));
    let colorSimilarity = Math.max(0, Math.min(1, baseSimilarity + 0.05));
    let featureSimilarity = Math.max(0, Math.min(1, baseSimilarity));

    let similarity: number;
    switch (method) {
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

  batchDescribe(
    imageIds: string[],
    options?: Parameters<ImageManager['describe']>[1]
  ): {
    results: { imageId: string; result: ImageDescriptionResult }[];
    failed: string[];
  } {
    const results: { imageId: string; result: ImageDescriptionResult }[] = [];
    const failed: string[] = [];

    for (const id of imageIds) {
      try {
        const result = this.describe(id, options);
        results.push({ imageId: id, result });
      } catch {
        failed.push(id);
      }
    }

    return { results, failed };
  }

  batchCompare(
    referenceImage: string,
    compareImages: string[],
    options?: Parameters<ImageManager['compare']>[2]
  ): {
    results: { imageId: string; result: ImageCompareResult }[];
  } {
    const results = compareImages.map((id) => ({
      imageId: id,
      result: this.compare(referenceImage, id, options),
    }));

    return { results };
  }

  setSimilarityThreshold(threshold: number): void {
    if (threshold < 0 || threshold > 1) {
      throw new Error('Threshold must be between 0 and 1');
    }
    this.defaultSimilarityThreshold = threshold;
  }

  getCount(): number {
    return this.images.size;
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
