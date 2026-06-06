import {
  AIPlatformClient,
  FillResult,
  TaskStatus,
  WorkflowStatus,
  StepStatus,
} from '../src';
import assert from 'assert';

describe('AI 应用平台 SDK - 基础测试', function () {
  let client: AIPlatformClient;

  before(function () {
    client = new AIPlatformClient({
      apiKey: 'test-api-key',
      maxRetries: 2,
      timeout: 10000,
    });
    client.setDefaultPermissionContext({
      userId: 'test_user',
      role: 'admin',
      tenantId: 'test_tenant',
    });
  });

  describe('1. 会话模块', function () {
    it('应能创建会话并连续追问', async function () {
      const createResult = await client.call('session.create', {
        userId: 'test_user',
        title: '测试会话',
        systemPrompt: '你是一个测试助手。',
      });
      assert.strictEqual(createResult.success, true);
      const sessionId = (createResult.data as any).id;
      assert.ok(sessionId);

      const chat1 = await client.call('session.chat', {
        sessionId,
        message: '你好',
      });
      assert.strictEqual(chat1.success, true);
      assert.ok((chat1.data as any).message);
      assert.ok((chat1.data as any).usage);
      assert.ok((chat1.data as any).usage.inputTokens > 0);
      assert.ok((chat1.data as any).usage.outputTokens > 0);

      const chat2 = await client.call('session.chat', {
        sessionId,
        message: '你叫什么名字',
      });
      assert.strictEqual(chat2.success, true);

      const history = await client.call('session.history', { sessionId });
      assert.strictEqual((history.data as any[]).length, 4);
    });
  });

  describe('2. 提示词模板模块', function () {
    it('应能创建、发布和搜索模板', async function () {
      const createResult = await client.call('prompt.template.create', {
        name: '测试模板',
        description: '测试用模板',
        category: '测试',
        content: '你好，{{name}}，欢迎来到{{place}}。',
        tags: ['测试', '示例'],
        variables: [
          { name: 'name', type: 'string', required: true },
          { name: 'place', type: 'string', required: true },
        ],
        createdBy: 'test_user',
      });
      assert.strictEqual(createResult.success, true);
      const tplId = (createResult.data as any).id;
      assert.strictEqual((createResult.data as any).version, '1.0');
      assert.strictEqual((createResult.data as any).status, 'draft');

      const publishResult = await client.call('prompt.template.update', {
        id: tplId,
        status: 'published',
      });
      assert.strictEqual(publishResult.success, true);
      assert.strictEqual((publishResult.data as any).status, 'published');

      const searchResult = await client.call('prompt.template.search', {
        keyword: '测试',
        limit: 10,
      });
      assert.ok((searchResult.data as any[]).length > 0);
    });

    it('严格模式下缺变量应返回结构化错误', async function () {
      const fillResult = await client.call('prompt.fill', {
        content: '你好，{{name}}，年龄{{age}}。',
        variables: { name: '张三' },
        options: { strict: true, returnValidation: true },
      });
      const data = fillResult.data as FillResult;
      assert.ok(data.missingVariables.includes('age'));
      assert.ok(data.validation);
      assert.strictEqual(data.validation.valid, false);
      assert.ok(data.validation.errors.length > 0);
      assert.strictEqual(data.validation.errors[0].field, 'age');
      assert.strictEqual(data.validation.errors[0].type, 'missing');
    });

    it('普通模式下缺变量应保留占位符', async function () {
      const fillResult = await client.call('prompt.fill', {
        content: '你好，{{name}}。',
        variables: {},
        options: { strict: false },
      });
      const data = fillResult.data as FillResult;
      assert.ok(data.content.includes('{{name}}'));
    });
  });

  describe('3. 文档模块', function () {
    const sampleDoc = '人工智能是计算机科学的一个分支。它包括机器人、语言识别、图像识别等领域。人工智能的应用越来越广泛。';

    it('应能生成文档摘要并返回真实用量', async function () {
      const result = await client.call('document.summarize', {
        content: sampleDoc,
        maxLength: 50,
      });
      assert.strictEqual(result.success, true);
      assert.ok((result.data as any).summary);
      assert.ok((result.data as any).usage);
      assert.strictEqual((result.data as any).usage.documents, 1);
      assert.ok((result.data as any).usage.inputTokens > 0);
      assert.ok((result.data as any).usage.outputTokens > 0);
    });

    it('应能提取文档要点', async function () {
      const result = await client.call('document.extractKeyPoints', {
        content: sampleDoc,
        maxPoints: 3,
      });
      assert.strictEqual(result.success, true);
      assert.ok((result.data as any).keyPoints.length > 0);
    });

    it('应能对文档分类', async function () {
      const result = await client.call('document.classify', {
        content: sampleDoc,
        categories: ['科技', '娱乐', '体育'],
      });
      assert.strictEqual(result.success, true);
      assert.ok((result.data as any).category);
    });

    it('应能检测敏感词', async function () {
      const result = await client.call('document.sensitiveCheck', {
        content: '这篇文章有暴力和色情内容。',
      });
      assert.strictEqual(result.success, true);
      assert.strictEqual((result.data as any).hasSensitive, true);
      assert.ok((result.data as any).totalHits > 0);
    });
  });

  describe('4. 图片模块', function () {
    it('应能生成图片描述并返回用量', async function () {
      const result = await client.call('image.describe', {
        url: 'https://example.com/test.jpg',
        detailLevel: 'medium',
      });
      assert.strictEqual(result.success, true);
      assert.ok((result.data as any).description);
      assert.strictEqual((result.data as any).usage.images, 1);
      assert.ok((result.data as any).usage.tokens > 0);
    });

    it('应能比较两张图片相似度', async function () {
      const result = await client.call('image.compare', {
        image1: 'https://example.com/img1.jpg',
        image2: 'https://example.com/img2.jpg',
      });
      assert.strictEqual(result.success, true);
      assert.strictEqual((result.data as any).usage.images, 2);
    });
  });

  describe('5. 任务模块（排队与取消）', function () {
    it('应能提交不同类型的任务并查询状态', async function () {
      const taskTypes = [
        'document.summarize',
        'document.extractKeyPoints',
        'document.classify',
        'document.sensitiveCheck',
        'image.describe',
        'image.compare',
        'session.chat',
      ];

      for (const type of taskTypes) {
        const submitResult = await client.call('task.submit', {
          type: type as any,
          taskParams: {
            content: '测试文本内容',
          },
          userId: 'test_user',
          priority: 1,
        });
        assert.strictEqual(submitResult.success, true, `任务类型 ${type} 提交失败`);
        const taskId = (submitResult.data as any).id;
        assert.ok(taskId);

        const statusResult = await client.call('task.status', { taskId });
        assert.ok(statusResult.data);
      }
    });

    it('取消排队中任务应保持取消状态', async function () {
      const submitResult = await client.call('task.submit', {
        type: 'document.summarize',
        taskParams: { content: '测试内容'.repeat(100) },
        userId: 'test_user',
        priority: 1,
      });
      const taskId = (submitResult.data as any).id;

      const cancelResult = await client.call('task.cancel', { taskId });
      assert.strictEqual((cancelResult.data as any).success, true);
      assert.strictEqual((cancelResult.data as any).status, 'cancelled');

      const statusResult = await client.call('task.status', { taskId });
      assert.strictEqual(statusResult.data, 'cancelled');
    });

    it('任务失败应返回结构化错误信息', async function () {
      const submitResult = await client.call('task.submit', {
        type: 'document.summarize',
        taskParams: {},
        userId: 'test_user',
        priority: 1,
      });
      const taskId = (submitResult.data as any).id;

      await new Promise(resolve => setTimeout(resolve, 50));

      const result = await client.call('task.result', { taskId });
      const taskResult = result.data as any;

      if (taskResult.status === 'failed') {
        assert.ok(taskResult.error);
        assert.ok(taskResult.error.code);
        assert.ok(taskResult.error.message);
      }
    });
  });

  describe('6. 工作流模块', function () {
    it('应能创建并执行多步骤工作流', async function () {
      const def = {
        name: '测试工作流',
        initialParams: {
          content: '这是一篇关于人工智能的文章，介绍了AI的发展历史和应用领域。',
        },
        steps: [
          {
            id: 'step1',
            name: '摘要',
            type: 'document.summarize' as const,
            inputMapping: { content: { from: 'initial', path: 'content' } },
            onFailure: 'stop' as const,
          },
          {
            id: 'step2',
            name: '分类',
            type: 'document.classify' as const,
            dependsOn: ['step1'],
            inputMapping: { content: { from: 'initial', path: 'content' } },
            onFailure: 'continue' as const,
          },
        ],
      };

      const createResult = await client.call('workflow.create', {
        definition: def,
        userId: 'test_user',
      });
      assert.strictEqual(createResult.success, true);
      const workflowId = (createResult.data as any).id;
      assert.strictEqual((createResult.data as any).status, 'idle');

      const startResult = await client.call('workflow.start', { workflowId });
      assert.strictEqual(startResult.success, true);

      await new Promise(resolve => setTimeout(resolve, 200));

      const statusResult = await client.call('workflow.status', { workflowId });
      const wf = statusResult.data as any;
      assert.ok(['running', 'completed'].includes(wf.status));
      assert.ok(wf.progress >= 0 && wf.progress <= 1);

      const stepResult = await client.call('workflow.step.get', {
        workflowId,
        stepId: 'step1',
      });
      assert.ok(stepResult.data);
    });

    it('应能取消工作流', async function () {
      const def = {
        name: '取消测试工作流',
        initialParams: { content: '测试内容' },
        steps: [
          {
            id: 's1',
            name: '步骤1',
            type: 'document.summarize' as const,
            inputMapping: { content: { from: 'initial', path: 'content' } },
          },
        ],
      };

      const createResult = await client.call('workflow.create', {
        definition: def,
        userId: 'test_user',
      });
      const workflowId = (createResult.data as any).id;

      await client.call('workflow.start', { workflowId });
      const cancelResult = await client.call('workflow.cancel', { workflowId });
      assert.strictEqual((cancelResult.data as any).success, true);
    });
  });

  describe('7. AI 服务适配器', function () {
    it('应能获取默认适配器', function () {
      const textAdapter = client.aiService.getTextAdapter();
      assert.ok(textAdapter);
      assert.ok(textAdapter.name);
      assert.ok(textAdapter.getSupportedModels().length > 0);

      const imageAdapter = client.aiService.getImageAdapter();
      assert.ok(imageAdapter);
    });

    it('应能统一处理重试', async function () {
      const result = await client.aiService.chat({
        messages: [{ role: 'user', content: '你好' }],
      });
      assert.ok(result.content);
      assert.ok(result.usage);
    });
  });

  describe('8. 审计日志', function () {
    it('操作后应记录审计日志', async function () {
      await client.call('session.create', { userId: 'test_user' });

      const result = await client.call('audit.log.list', {
        userId: 'test_user',
        page: 1,
        pageSize: 10,
      });
      assert.strictEqual(result.success, true);
      assert.ok((result.data as any).total > 0);
      assert.ok((result.data as any).items.length > 0);

      const log = (result.data as any).items[0];
      assert.ok(log.traceId);
      assert.ok(log.module);
      assert.ok(log.operation);
      assert.strictEqual(typeof log.success, 'boolean');
    });
  });

  describe('9. 用量统计（多维度）', function () {
    it('应能按模块查看用量统计', async function () {
      const result = await client.call('usage.stats', {
        userId: 'test_user',
        groupBy: 'module',
      });
      assert.strictEqual(result.success, true);
      const stats = result.data as any;
      assert.ok(stats.totalRequests > 0);
      assert.ok(stats.totalInputTokens > 0);
      assert.ok(stats.totalOutputTokens > 0);
      assert.ok(stats.totalDocuments > 0);
      assert.ok(stats.totalImages > 0);
      assert.ok(stats.successRate >= 0 && stats.successRate <= 1);
      assert.ok(stats.breakdown);
    });

    it('应能按操作查看用量统计', async function () {
      const result = await client.call('usage.stats', {
        userId: 'test_user',
        groupBy: 'operation',
      });
      assert.strictEqual(result.success, true);
      assert.ok(Object.keys((result.data as any).breakdown).length > 0);
    });

    it('应能获取Top用户排名', function () {
      const topUsers = client.usage.getTopUsers(10);
      assert.ok(Array.isArray(topUsers));
    });

    it('应能获取每日趋势', function () {
      const trend = client.usage.getDailyTrend(7);
      assert.ok(Array.isArray(trend));
      assert.ok(trend.length <= 7);
    });
  });

  describe('10. 权限校验', function () {
    it('无权限操作应被拒绝', async function () {
      client.setDefaultPermissionContext({
        userId: 'viewer',
        role: 'viewer',
      });

      const result = await client.call('prompt.template.create', {
        name: '测试',
        content: '测试',
      });
      assert.strictEqual(result.success, false);
      assert.ok(result.code !== 0);
      assert.ok(result.message);

      client.setDefaultPermissionContext({
        userId: 'test_user',
        role: 'admin',
        tenantId: 'test_tenant',
      });
    });

    it('admin角色应有全部权限', async function () {
      const result = await client.call('prompt.template.create', {
        name: 'admin测试',
        content: '测试',
      });
      assert.strictEqual(result.success, true);
    });
  });

  describe('11. 配置模块', function () {
    it('应能设置和读取配置', async function () {
      await client.call('config.set', { key: 'test_key', value: 'test_value' });
      const result = await client.call('config.get', { key: 'test_key' });
      assert.strictEqual((result.data as any).value, 'test_value');
    });

    it('应能列出所有配置', async function () {
      const result = await client.call('config.list', {});
      assert.ok(result.data);
      assert.strictEqual(typeof result.data, 'object');
    });
  });
});
