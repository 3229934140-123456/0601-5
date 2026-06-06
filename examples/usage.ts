import { AIPlatformClient, OperationType, BaseResponse } from '../src';

async function main() {
  console.log('=== AI 应用平台 SDK 使用示例 ===\n');

  const client = new AIPlatformClient({
    apiKey: 'demo-api-key-12345',
    apiBaseUrl: 'https://api.example.com',
    maxRetries: 3,
    timeout: 30000,
  });

  client.setDefaultPermissionContext({
    userId: 'user_001',
    role: 'admin',
    tenantId: 'tenant_001',
  });

  console.log('--- 1. 会话模块 ---\n');

  const createResult = await client.call('session.create', {
    userId: 'user_001',
    title: '我的第一个会话',
    systemPrompt: '你是一个专业的助手，请用简洁的语言回答问题。',
  });
  console.log('创建会话:', createResult.success ? '成功' : '失败');
  const sessionId = (createResult.data as any).id;
  console.log('会话ID:', sessionId);

  const chatResult = await client.call('session.chat', {
    sessionId,
    message: '你好，请介绍一下自己。',
  });
  console.log('首次对话:', chatResult.success ? '成功' : '失败');
  if (chatResult.success) {
    console.log('AI 回复:', (chatResult.data as any).message.content);
    console.log('Token 使用量:', JSON.stringify((chatResult.data as any).usage));
  }

  const chatResult2 = await client.call('session.chat', {
    sessionId,
    message: '那你能帮我做什么？',
  });
  console.log('连续追问:', chatResult2.success ? '成功' : '失败');
  if (chatResult2.success) {
    console.log('AI 回复:', (chatResult2.data as any).message.content);
  }

  const historyResult = await client.call('session.history', { sessionId });
  console.log('历史消息数:', (historyResult.data as any[])?.length || 0);

  console.log('\n--- 2. 提示词模块 ---\n');

  const createTplResult = await client.call('prompt.template.create', {
    name: '产品介绍模板',
    description: '用于生成产品介绍文案',
    category: '营销',
    content: '请为{{productName}}写一段产品介绍，面向{{targetAudience}}，突出产品的{{keyFeature}}特点。字数控制在{{wordCount || 200}}字以内。',
    tags: ['营销', '文案', '产品'],
    createdBy: 'user_001',
  });
  console.log('创建模板:', createTplResult.success ? '成功' : '失败');
  const templateId = (createTplResult.data as any).id;
  console.log('模板ID:', templateId);

  const fillResult = await client.call('prompt.fill', {
    content: '你好，我是{{name}}，今年{{age}}岁，职业是{{job || "学生"}}。',
    variables: {
      name: '张三',
      age: 28,
    },
  });
  console.log('提示词填充结果:', fillResult.data);

  const fillTemplateResult = await client.call('prompt.template.get', { id: templateId });
  console.log('获取模板:', fillTemplateResult.success ? '成功' : '失败');

  const listTplResult = await client.call('prompt.template.list', { page: 1, pageSize: 10 });
  console.log('模板总数:', (listTplResult.data as any).total);

  console.log('\n--- 3. 文档模块 ---\n');

  const sampleDoc = `人工智能（AI）是计算机科学的一个分支，它企图了解智能的实质，并生产出一种新的能以人类智能相似的方式做出反应的智能机器。

首先，人工智能的研究领域包括机器人、语言识别、图像识别、自然语言处理和专家系统等。其次，人工智能从诞生以来，理论和技术日益成熟，应用领域也不断扩大。最后，可以设想，未来人工智能带来的科技产品，将会是人类智慧的"容器"。

人工智能可以对人的意识、思维的信息过程的模拟。人工智能不是人的智能，但能像人那样思考、也可能超过人的智能。

重要的是，人工智能是一门极富挑战性的科学，从事这项工作的人必须懂得计算机知识，心理学和哲学。`;

  const summarizeResult = await client.call('document.summarize', {
    content: sampleDoc,
    maxLength: 150,
  });
  console.log('文档摘要:', summarizeResult.success ? '成功' : '失败');
  if (summarizeResult.success) {
    console.log('摘要内容:', (summarizeResult.data as any).summary);
    console.log('压缩率:', ((summarizeResult.data as any).compressionRatio * 100).toFixed(1) + '%');
  }

  const keyPointsResult = await client.call('document.extractKeyPoints', {
    content: sampleDoc,
    maxPoints: 5,
  });
  console.log('要点提取:', keyPointsResult.success ? '成功' : '失败');
  if (keyPointsResult.success) {
    console.log('提取要点数:', (keyPointsResult.data as any).total);
    (keyPointsResult.data as any).keyPoints.forEach((kp: any, i: number) => {
      console.log(`  ${i + 1}. ${kp.text.substring(0, 50)}...`);
    });
  }

  const classifyResult = await client.call('document.classify', {
    content: sampleDoc,
  });
  console.log('文档分类:', classifyResult.success ? '成功' : '失败');
  if (classifyResult.success) {
    console.log('分类结果:', (classifyResult.data as any).category);
    console.log('置信度:', ((classifyResult.data as any).confidence * 100).toFixed(1) + '%');
  }

  const sensitiveResult = await client.call('document.sensitiveCheck', {
    content: '这是一篇正常的文章，没有暴力色情内容。但是提到了加微信好友可以免费领取优惠券。',
  });
  console.log('敏感词检查:', sensitiveResult.success ? '成功' : '失败');
  if (sensitiveResult.success) {
    console.log('是否含敏感内容:', (sensitiveResult.data as any).hasSensitive ? '是' : '否');
    console.log('命中数量:', (sensitiveResult.data as any).totalHits);
    if ((sensitiveResult.data as any).hits.length > 0) {
      console.log('命中词:', (sensitiveResult.data as any).hits.map((h: any) => h.word).join(', '));
    }
  }

  console.log('\n--- 4. 图片模块 ---\n');

  const describeResult = await client.call('image.describe', {
    url: 'https://example.com/image1.jpg',
    detailLevel: 'medium',
  });
  console.log('图片说明:', describeResult.success ? '成功' : '失败');
  if (describeResult.success) {
    console.log('描述:', (describeResult.data as any).description);
    console.log('标签:', (describeResult.data as any).tags?.join(', '));
  }

  const compareResult = await client.call('image.compare', {
    image1: 'image_id_1',
    image2: 'image_id_2',
    threshold: 0.7,
  });
  console.log('图片对比:', compareResult.success ? '成功' : '失败');
  if (compareResult.success) {
    console.log('相似度:', ((compareResult.data as any).similarity * 100).toFixed(2) + '%');
    console.log('是否相似:', (compareResult.data as any).isSimilar ? '是' : '否');
  }

  console.log('\n--- 5. 任务模块 ---\n');

  const submitResult = await client.call('task.submit', {
    type: 'document.summarize',
    taskParams: {
      content: '这是一段需要摘要的长文本内容。' + sampleDoc + sampleDoc,
    },
    userId: 'user_001',
    priority: 1,
  });
  console.log('提交任务:', submitResult.success ? '成功' : '失败');
  const taskId = (submitResult.data as any).id;
  console.log('任务ID:', taskId);
  console.log('任务状态:', (submitResult.data as any).status);

  const statusResult = await client.call('task.status', { taskId });
  console.log('查询状态:', statusResult.data);

  const taskListResult = await client.call('task.list', { userId: 'user_001' });
  console.log('任务列表总数:', (taskListResult.data as any).total);

  const queueStats = client.task.getQueueStats();
  console.log('队列统计:', JSON.stringify(queueStats));

  console.log('\n--- 6. 审计模块 ---\n');

  const auditListResult = await client.call('audit.log.list', {
    userId: 'user_001',
    page: 1,
    pageSize: 10,
  });
  console.log('审计日志:', auditListResult.success ? '成功' : '失败');
  if (auditListResult.success) {
    console.log('日志总数:', (auditListResult.data as any).total);
    const logs = (auditListResult.data as any).items;
    if (logs.length > 0) {
      console.log('最近操作:', logs[0].operation);
      console.log('操作状态:', logs[0].success ? '成功' : '失败');
    }
  }

  console.log('\n--- 7. 配置模块 ---\n');

  const setConfigResult = await client.call('config.set', {
    key: 'theme',
    value: 'dark',
  });
  console.log('设置配置:', setConfigResult.success ? '成功' : '失败');

  const getConfigResult = await client.call('config.get', { key: 'theme' });
  console.log('获取配置:', (getConfigResult.data as any)?.value);

  const listConfigResult = await client.call('config.list', {});
  console.log('配置项数量:', Object.keys(listConfigResult.data || {}).length);

  console.log('\n--- 8. 用量统计 ---\n');

  const usageResult = await client.call('usage.stats', {
    userId: 'user_001',
    groupBy: 'module',
  });
  console.log('用量统计:', usageResult.success ? '成功' : '失败');
  if (usageResult.success) {
    console.log('总请求数:', (usageResult.data as any).totalRequests);
    console.log('总耗时:', (usageResult.data as any).totalDuration + 'ms');
    if ((usageResult.data as any).breakdown) {
      console.log('各模块用量:');
      for (const [module, stats] of Object.entries((usageResult.data as any).breakdown || {})) {
        console.log(`  ${module}: ${(stats as any).requests} 次请求`);
      }
    }
  }

  console.log('\n--- 9. 错误处理与权限校验 ---\n');

  client.setDefaultPermissionContext({
    userId: 'viewer_user',
    role: 'viewer',
  });

  const forbiddenResult = await client.call('prompt.template.create', {
    name: '测试模板',
    content: '测试内容',
  });
  console.log('无权限操作:', forbiddenResult.success ? '意外成功' : '正确拒绝');
  console.log('错误信息:', forbiddenResult.message);

  console.log('\n=== 所有示例执行完毕 ===');
}

main().catch((error) => {
  console.error('执行出错:', error);
  process.exit(1);
});
