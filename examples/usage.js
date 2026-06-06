const { AIPlatformClient } = require('../dist/index');

async function main() {
  console.log('=== AI 应用平台 SDK - JavaScript 示例 ===\n');

  const client = new AIPlatformClient({
    apiKey: 'demo-api-key-12345',
    maxRetries: 3,
  });

  client.setDefaultPermissionContext({
    userId: 'demo_user',
    role: 'admin',
  });

  const sessionRes = await client.call('session.create', {
    userId: 'demo_user',
    title: '测试会话',
    systemPrompt: '你是一个友好的助手。',
  });
  console.log('1. 创建会话:', sessionRes.success ? '✓' : '✗', sessionRes.data?.id);

  const chatRes = await client.call('session.chat', {
    sessionId: sessionRes.data.id,
    message: '你好，请介绍一下自己。',
  });
  console.log('2. 发送消息:', chatRes.success ? '✓' : '✗');
  console.log('   AI回复:', chatRes.data?.message?.content?.substring(0, 60) + '...');

  const promptRes = await client.call('prompt.fill', {
    content: 'Hello, {{name}}! You are {{age}} years old.',
    variables: { name: 'Alice', age: 25 },
  });
  console.log('3. 提示词填充:', promptRes.data);

  const docText = `人工智能是计算机科学的一个分支。首先，它包括机器学习、深度学习等技术。其次，人工智能应用广泛，涉及医疗、金融、教育等多个领域。最后，人工智能的发展正在深刻改变我们的生活方式。

重要的是，我们需要理性看待人工智能的发展，既要充分利用其优势，也要注意防范潜在风险。`;

  const summaryRes = await client.call('document.summarize', {
    content: docText,
    maxLength: 100,
  });
  console.log('4. 文档摘要:', summaryRes.success ? '✓' : '✗');
  console.log('   摘要:', summaryRes.data?.summary?.substring(0, 80) + '...');

  const keyPointsRes = await client.call('document.extractKeyPoints', {
    content: docText,
  });
  console.log('5. 要点提取:', keyPointsRes.success ? '✓' : '✗', '共', keyPointsRes.data?.total, '个要点');

  const classifyRes = await client.call('document.classify', { content: docText });
  console.log('6. 文档分类:', classifyRes.data?.category, '(' + (classifyRes.data?.confidence * 100).toFixed(1) + '%)');

  const sensitiveRes = await client.call('document.sensitiveCheck', {
    content: '正常内容，但含有暴力和加微信免费领取等字样。',
  });
  console.log('7. 敏感词检测:', sensitiveRes.data?.hasSensitive ? '存在' : '不存在', '敏感内容');
  console.log('   命中数:', sensitiveRes.data?.totalHits);

  const imgDescRes = await client.call('image.describe', {
    url: 'https://example.com/test.jpg',
    detailLevel: 'low',
  });
  console.log('8. 图片描述:', imgDescRes.data?.description?.substring(0, 50) + '...');

  const imgCompareRes = await client.call('image.compare', {
    image1: 'img_a',
    image2: 'img_b',
  });
  console.log('9. 图片相似度:', (imgCompareRes.data?.similarity * 100).toFixed(2) + '%');

  const taskRes = await client.call('task.submit', {
    type: 'document.summarize',
    taskParams: { content: docText },
    userId: 'demo_user',
  });
  console.log('10. 提交任务:', taskRes.data?.id, '状态:', taskRes.data?.status);

  const taskListRes = await client.call('task.list', { userId: 'demo_user' });
  console.log('    任务总数:', taskListRes.data?.total);

  const auditRes = await client.call('audit.log.list', { page: 1, pageSize: 5 });
  console.log('11. 审计日志:', auditRes.data?.total, '条记录');

  const usageRes = await client.call('usage.stats', { groupBy: 'module' });
  console.log('12. 用量统计: 总请求', usageRes.data?.totalRequests, '次');
  console.log('    模块分布:', Object.keys(usageRes.data?.breakdown || {}).length, '个模块');

  console.log('\n=== 示例执行完成 ===');
}

main().catch(console.error);
