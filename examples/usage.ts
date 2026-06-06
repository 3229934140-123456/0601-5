import { AIPlatformClient, OperationType, BaseResponse, FillResult } from '../src';

async function main() {
  console.log('=== AI 应用平台 SDK - 完整使用示例 ===\n');

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

  console.log('--- 1. 会话模块（连续追问） ---\n');

  const createResult = await client.call('session.create', {
    userId: 'user_001',
    title: '智能对话测试',
    systemPrompt: '你是一个专业的助手，请用简洁的语言回答问题。',
  });
  const sessionId = (createResult.data as any).id;
  console.log('创建会话:', createResult.success ? '成功' : '失败', 'ID:', sessionId);

  const chat1 = await client.call('session.chat', {
    sessionId,
    message: '你好，请介绍一下自己。',
  });
  console.log('第1轮对话:', chat1.success ? '成功' : '失败');
  console.log('  回复:', (chat1.data as any).message.content.substring(0, 80) + '...');
  console.log('  用量:', JSON.stringify((chat1.data as any).usage));

  const chat2 = await client.call('session.chat', {
    sessionId,
    message: '那你能帮我做文档摘要吗？',
  });
  console.log('第2轮对话:', chat2.success ? '成功' : '失败');
  console.log('  回复:', (chat2.data as any).message.content.substring(0, 80) + '...');

  const chat3 = await client.call('session.chat', {
    sessionId,
    message: '那图片处理呢？',
  });
  console.log('第3轮对话:', chat3.success ? '成功' : '失败');
  console.log('  回复:', (chat3.data as any).message.content.substring(0, 80) + '...');

  const history = await client.call('session.history', { sessionId });
  console.log('历史消息数:', (history.data as any[])?.length || 0);

  console.log('\n--- 2. 提示词模板（版本、发布、严格模式） ---\n');

  const tpl1 = await client.call('prompt.template.create', {
    name: '产品介绍模板',
    description: '用于生成产品介绍文案',
    category: '营销',
    content: '请为{{productName}}写一段产品介绍，面向{{targetAudience}}，突出{{keyFeature}}特点，控制在{{wordCount}}字以内。',
    tags: ['营销', '文案', '产品'],
    variables: [
      { name: 'productName', type: 'string', required: true },
      { name: 'targetAudience', type: 'string', required: true },
      { name: 'keyFeature', type: 'string', required: true },
      { name: 'wordCount', type: 'number', required: false, defaultValue: 200 },
    ],
    createdBy: 'user_001',
  });
  const tplId = (tpl1.data as any).id;
  console.log('创建模板:', tpl1.success ? '成功' : '失败', 'ID:', tplId);
  console.log('  初始版本:', (tpl1.data as any).version);
  console.log('  初始状态:', (tpl1.data as any).status);

  const publishTpl = await client.call('prompt.template.update', {
    id: tplId,
    status: 'published',
  });
  console.log('发布模板:', publishTpl.success ? '成功' : '失败');
  console.log('  发布版本:', (publishTpl.data as any).version);
  console.log('  发布状态:', (publishTpl.data as any).status);

  const fillNormal = await client.call('prompt.fill', {
    content: '你好，我是{{name}}，今年{{age}}岁。',
    variables: { name: '张三' },
    options: { strict: false },
  });
  console.log('普通模式填充:', (fillNormal.data as FillResult).content);
  console.log('  缺失变量:', (fillNormal.data as FillResult).missingVariables);

  const fillStrict = await client.call('prompt.fill', {
    content: '你好，我是{{name}}，今年{{age}}岁。',
    variables: { name: '张三' },
    options: { strict: true, returnValidation: true },
  });
  console.log('严格模式填充:');
  console.log('  填充后内容:', (fillStrict.data as FillResult).content);
  console.log('  缺失变量:', (fillStrict.data as FillResult).missingVariables);
  console.log('  校验结果:', JSON.stringify((fillStrict.data as FillResult).validation));

  const searchTpl = await client.call('prompt.template.search', {
    keyword: '产品',
    limit: 5,
  });
  console.log('搜索模板 "产品": 找到', (searchTpl.data as any[]).length, '个');

  const fillTemplateResult = await client.prompt.fillTemplate(tplId, {
    productName: '智能音箱',
    targetAudience: '年轻消费者',
    keyFeature: '语音控制',
  }, { strict: true, returnValidation: true });
  console.log('填充模板:', fillTemplateResult.validation?.valid ? '成功' : '失败');
  console.log('  内容:', fillTemplateResult.content.substring(0, 60) + '...');

  console.log('\n--- 3. 文档处理 ---\n');

  const sampleDoc = `人工智能（AI）是计算机科学的一个分支，它企图了解智能的实质，并生产出一种新的能以人类智能相似的方式做出反应的智能机器。

首先，人工智能的研究领域包括机器人、语言识别、图像识别、自然语言处理和专家系统等。其次，人工智能从诞生以来，理论和技术日益成熟，应用领域也不断扩大。最后，可以设想，未来人工智能带来的科技产品，将会是人类智慧的"容器"。

人工智能可以对人的意识、思维的信息过程的模拟。人工智能不是人的智能，但能像人那样思考、也可能超过人的智能。

重要的是，人工智能是一门极富挑战性的科学，从事这项工作的人必须懂得计算机知识，心理学和哲学。`;

  const summarizeResult = await client.call('document.summarize', {
    content: sampleDoc,
    maxLength: 150,
  });
  console.log('文档摘要:', summarizeResult.success ? '成功' : '失败');
  console.log('  摘要:', (summarizeResult.data as any).summary.substring(0, 80) + '...');
  console.log('  用量:', JSON.stringify((summarizeResult.data as any).usage));

  const keyPointsResult = await client.call('document.extractKeyPoints', {
    content: sampleDoc,
    maxPoints: 5,
  });
  console.log('要点提取:', keyPointsResult.success ? '成功' : '失败');
  console.log('  要点数:', (keyPointsResult.data as any).total);
  console.log('  用量:', JSON.stringify((keyPointsResult.data as any).usage));

  const classifyResult = await client.call('document.classify', {
    content: sampleDoc,
    categories: ['科技', '娱乐', '体育', '财经'],
  });
  console.log('文档分类:', classifyResult.success ? '成功' : '失败');
  console.log('  分类:', (classifyResult.data as any).category);
  console.log('  置信度:', ((classifyResult.data as any).confidence * 100).toFixed(1) + '%');

  const sensitiveResult = await client.call('document.sensitiveCheck', {
    content: '这是一篇正常的文章。但是提到了加微信好友可以免费领取优惠券，还有暴力相关内容。',
  });
  console.log('敏感词检查:', sensitiveResult.success ? '成功' : '失败');
  console.log('  含敏感内容:', (sensitiveResult.data as any).hasSensitive ? '是' : '否');
  console.log('  命中数:', (sensitiveResult.data as any).totalHits);

  console.log('\n--- 4. 图片处理 ---\n');

  const describeResult = await client.call('image.describe', {
    url: 'https://example.com/image1.jpg',
    detailLevel: 'medium',
    language: 'zh',
  });
  console.log('图片说明:', describeResult.success ? '成功' : '失败');
  console.log('  描述:', (describeResult.data as any).description.substring(0, 60) + '...');
  console.log('  标签:', (describeResult.data as any).tags?.join(', '));
  console.log('  用量:', JSON.stringify((describeResult.data as any).usage));

  const compareResult = await client.call('image.compare', {
    image1: 'https://example.com/image1.jpg',
    image2: 'https://example.com/image2.jpg',
    method: 'hybrid',
  });
  console.log('图片对比:', compareResult.success ? '成功' : '失败');
  console.log('  相似度:', ((compareResult.data as any).similarity * 100).toFixed(2) + '%');
  console.log('  是否相似:', (compareResult.data as any).isSimilar ? '是' : '否');
  console.log('  用量:', JSON.stringify((compareResult.data as any).usage));

  console.log('\n--- 5. 任务排队与取消 ---\n');

  const task1 = await client.call('task.submit', {
    type: 'document.summarize',
    taskParams: {
      content: sampleDoc + sampleDoc + sampleDoc,
      maxLength: 200,
    },
    userId: 'user_001',
    priority: 2,
  });
  const taskId1 = (task1.data as any).id;
  console.log('提交摘要任务:', task1.success ? '成功' : '失败');
  console.log('  任务ID:', taskId1);
  console.log('  状态:', (task1.data as any).status);

  const task2 = await client.call('task.submit', {
    type: 'image.describe',
    taskParams: {
      url: 'https://example.com/big-image.jpg',
      detailLevel: 'high',
    },
    userId: 'user_001',
    priority: 1,
  });
  const taskId2 = (task2.data as any).id;
  console.log('提交图片描述任务:', task2.success ? '成功' : '失败', 'ID:', taskId2);

  const task3 = await client.call('task.submit', {
    type: 'session.chat',
    taskParams: {
      message: '请帮我写一首关于春天的诗',
      systemPrompt: '你是一个诗人',
    },
    userId: 'user_001',
    priority: 3,
  });
  const taskId3 = (task3.data as any).id;
  console.log('提交会话任务:', task3.success ? '成功' : '失败', 'ID:', taskId3);

  const taskList = await client.call('task.list', { userId: 'user_001' });
  console.log('任务列表总数:', (taskList.data as any).total);

  const queueStats = client.task.getQueueStats();
  console.log('队列统计:', JSON.stringify(queueStats));

  const cancelResult = await client.call('task.cancel', { taskId: taskId3 });
  console.log('取消会话任务:');
  console.log('  成功:', (cancelResult.data as any).success);
  console.log('  当前状态:', (cancelResult.data as any).status);
  console.log('  消息:', (cancelResult.data as any).message);

  const statusAfterCancel = await client.call('task.status', { taskId: taskId3 });
  console.log('  取消后状态:', statusAfterCancel.data);

  console.log('\n--- 6. 工作流模块 ---\n');

  const sampleDocForWf = sampleDoc;

  const workflowDef = {
    name: '文档智能处理流程',
    description: '对文档进行敏感词检查、摘要提取和分类',
    initialParams: {
      content: sampleDocForWf,
    },
    steps: [
      {
        id: 'step1',
        name: '敏感词检查',
        type: 'document.sensitiveCheck' as const,
        inputMapping: {
          content: { from: 'initial', path: 'content' },
        },
        onFailure: 'stop' as const,
      },
      {
        id: 'step2',
        name: '文档摘要',
        type: 'document.summarize' as const,
        dependsOn: ['step1'],
        inputMapping: {
          content: { from: 'initial', path: 'content' },
          maxLength: { value: 100 },
        },
        onFailure: 'retry' as const,
        maxRetries: 2,
      },
      {
        id: 'step3',
        name: '文档分类',
        type: 'document.classify' as const,
        dependsOn: ['step1'],
        inputMapping: {
          content: { from: 'initial', path: 'content' },
          categories: { value: ['科技', '财经', '娱乐'] },
        },
        onFailure: 'continue' as const,
      },
    ],
  };

  const wfCreate = await client.call('workflow.create', {
    definition: workflowDef,
    userId: 'user_001',
    tenantId: 'tenant_001',
  });
  const workflowId = (wfCreate.data as any).id;
  console.log('创建工作流:', wfCreate.success ? '成功' : '失败', 'ID:', workflowId);

  const wfStart = await client.call('workflow.start', {
    workflowId,
  });
  console.log('启动工作流:', wfStart.success ? '成功' : '失败');

  let wfStatus = await client.call('workflow.status', { workflowId });
  console.log('  当前状态:', (wfStatus.data as any).status);

  await new Promise(resolve => setTimeout(resolve, 200));

  wfStatus = await client.call('workflow.status', { workflowId });
  console.log('  稍后状态:', (wfStatus.data as any).status);
  console.log('  进度:', ((wfStatus.data as any).progress * 100).toFixed(0) + '%');

  const step1 = await client.call('workflow.step.get', {
    workflowId,
    stepId: 'step1',
  });
  console.log('  步骤1(敏感词检查):');
  console.log('    状态:', (step1.data as any).status);
  console.log('    耗时:', (step1.data as any).duration + 'ms');

  const step2 = await client.call('workflow.step.get', {
    workflowId,
    stepId: 'step2',
  });
  console.log('  步骤2(摘要):');
  console.log('    状态:', (step2.data as any).status);
  if ((step2.data as any).result) {
    console.log('    结果摘要:', ((step2.data as any).result as any).summary.substring(0, 50) + '...');
  }

  const step3 = await client.call('workflow.step.get', {
    workflowId,
    stepId: 'step3',
  });
  console.log('  步骤3(分类):');
  console.log('    状态:', (step3.data as any).status);
  if ((step3.data as any).result) {
    console.log('    分类:', ((step3.data as any).result as any).category);
  }

  const wfUsage = client.workflow.getUsage(workflowId);
  console.log('  工作流统计:');
  console.log('    总步骤:', wfUsage.totalSteps);
  console.log('    已完成:', wfUsage.completedSteps);
  console.log('    失败:', wfUsage.failedSteps);
  console.log('    总Token:', wfUsage.totalTokens);
  console.log('    输入Token:', wfUsage.totalInputTokens);
  console.log('    输出Token:', wfUsage.totalOutputTokens);
  console.log('    图片数:', wfUsage.totalImages);
  console.log('    文档数:', wfUsage.totalDocuments);

  console.log('\n--- 7. AI 服务适配器 ---\n');

  const defaultTextAdapter = client.aiService.getTextAdapter();
  console.log('默认文本适配器:', defaultTextAdapter.name);
  console.log('  支持模型:', defaultTextAdapter.getSupportedModels().join(', '));

  const defaultImageAdapter = client.aiService.getImageAdapter();
  console.log('默认图片适配器:', defaultImageAdapter.name);

  console.log('\n--- 8. 审计日志 ---\n');

  const auditList = await client.call('audit.log.list', {
    userId: 'user_001',
    page: 1,
    pageSize: 10,
  });
  console.log('审计日志总数:', (auditList.data as any).total);
  const logs = (auditList.data as any).items;
  if (logs.length > 0) {
    console.log('  最近操作:', logs[0].operation);
    console.log('  操作状态:', logs[0].success ? '成功' : '失败');
    console.log('  关联用量:', logs[0].usage ? JSON.stringify(logs[0].usage) : '无');
  }

  console.log('\n--- 9. 用量统计（多维度） ---\n');

  const usageByModule = await client.call('usage.stats', {
    userId: 'user_001',
    groupBy: 'module',
  });
  console.log('按模块分组:');
  console.log('  总请求数:', (usageByModule.data as any).totalRequests);
  console.log('  总输入Token:', (usageByModule.data as any).totalInputTokens);
  console.log('  总输出Token:', (usageByModule.data as any).totalOutputTokens);
  console.log('  总图片数:', (usageByModule.data as any).totalImages);
  console.log('  总文档数:', (usageByModule.data as any).totalDocuments);
  console.log('  总耗时:', (usageByModule.data as any).totalDuration + 'ms');
  console.log('  成功率:', ((usageByModule.data as any).successRate * 100).toFixed(1) + '%');

  if ((usageByModule.data as any).breakdown) {
    console.log('  各模块详情:');
    for (const [module, stats] of Object.entries((usageByModule.data as any).breakdown || {})) {
      const s = stats as any;
      console.log(`    ${module}:`);
      console.log(`      请求数: ${s.requests}, 成功: ${s.successRequests}, 失败: ${s.failedRequests}`);
      console.log(`      Token: ${s.totalTokens} (输入: ${s.totalInputTokens}, 输出: ${s.totalOutputTokens})`);
      console.log(`      图片: ${s.totalImages}, 文档: ${s.totalDocuments}`);
    }
  }

  const usageByOperation = await client.call('usage.stats', {
    userId: 'user_001',
    groupBy: 'operation',
  });
  console.log('\n按操作分组的统计项数:', Object.keys((usageByOperation.data as any).breakdown || {}).length);

  const topUsers = client.usage.getTopUsers(5);
  console.log('\nTop用户:', topUsers.length, '个');
  if (topUsers.length > 0) {
    console.log('  第1名:', topUsers[0].userId, '-', topUsers[0].totalRequests, '次请求');
  }

  const dailyTrend = client.usage.getDailyTrend(7);
  console.log('近7天趋势:', dailyTrend.length, '天数据');

  console.log('\n--- 10. 权限校验 ---\n');

  client.setDefaultPermissionContext({
    userId: 'viewer_user',
    role: 'viewer',
  });

  const forbiddenResult = await client.call('prompt.template.create', {
    name: '测试模板',
    content: '测试内容',
  });
  console.log('viewer角色创建模板:', forbiddenResult.success ? '意外成功' : '正确拒绝');
  console.log('  错误码:', forbiddenResult.code);
  console.log('  错误信息:', forbiddenResult.message);

  client.setDefaultPermissionContext({
    userId: 'user_001',
    role: 'admin',
    tenantId: 'tenant_001',
  });

  console.log('\n=== 所有示例执行完成 ===');
}

main().catch((error) => {
  console.error('执行出错:', error);
  process.exit(1);
});
