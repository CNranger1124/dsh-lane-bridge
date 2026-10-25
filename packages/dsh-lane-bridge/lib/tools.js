// Per-conversation agent tools.
//
// These definitions are registered on `agent.ctx` (the conversation's own
// scope), never globally, so an ordinary DSH coding session does not see
// `lane_send` / `lane_kb_*` in its tool list.
import { conversationLabel, resolveConversation } from './router.js';
import { listKnowledge, readKnowledge, searchKnowledge, writeDraft } from './knowledge.js';
import { normalizeMessages, splitText, stripMarkdown } from './text.js';

const TEXT_SCHEMA = { type: 'string' };

function textResult(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }];
}

function define(name, description, parameters, execute, outputSchema = { type: 'object' }) {
  return {
    name,
    description,
    parameters,
    output: {
      schema: outputSchema,
      render: (_args, value) => textResult(value),
    },
    async execute(args, exec) {
      return execute(args ?? {}, exec);
    },
  };
}

function searchTargets(state, needle) {
  const query = String(needle ?? '').trim().toLowerCase();
  if (!query) return [];
  const keys = new Set([...Object.keys(state.bindings ?? {}), ...Object.keys(state.conversations ?? {})]);
  const hits = [];
  for (const key of keys) {
    const label = conversationLabel(state, key).toLowerCase();
    const convo = state.conversations?.[key];
    if (key.toLowerCase() === query || key.toLowerCase().includes(query) || label.includes(query)) {
      hits.push(key);
    }
  }
  return hits;
}

export function createLaneTools({ key, pool, store, knowledgeDir, memoryStore = null, repo = null, logger = null }) {
  const getState = () => store.get();
  const currentResolved = () => resolveConversation(getState(), key);

  const laneSend = define(
    'lane_send',
    '向当前会话或另一个已绑定会话发送消息。messages 字符串=一条，数组=多条。需要在同一轮里分多条气泡、或主动推送到别的群/私聊时使用；用了本工具的这一轮，最终文本不会再自动发送。',
    {
      type: 'object',
      properties: {
        target: { ...TEXT_SCHEMA, description: '目标会话 key（如 snowluma:group:123456）或会话名称；省略=当前会话' },
        targets: { type: 'array', items: TEXT_SCHEMA, description: '可选：广播到多个已绑定会话' },
        messages: {
          oneOf: [
            TEXT_SCHEMA,
            { type: 'array', items: TEXT_SCHEMA, description: '多条消息，按顺序发送' },
          ],
        },
      },
      required: ['messages'],
      additionalProperties: false,
    },
    async (args) => {
      const state = getState();
      const resolveTarget = (value) => {
        let targetKey = String(value ?? '').trim();
        if (!targetKey) return key;
        if (!/^[^:]+:(group|private):.+/u.test(targetKey)) {
          const hits = searchTargets(state, targetKey);
          if (hits.length === 0) throw new Error(`找不到会话「${targetKey}」；请用 lane_conversation_info 或 Settings 里的会话 key`);
          if (hits.length > 1) throw new Error(`「${targetKey}」匹配到多个会话：${hits.join('、')}；请改用完整 key`);
          targetKey = hits[0];
        }
        if (targetKey !== key && !state.bindings?.[targetKey]) {
          throw new Error(`目标会话未绑定：${targetKey}；只能向当前会话或已绑定会话发送`);
        }
        return targetKey;
      };
      const rawTargets = Array.isArray(args.targets) && args.targets.length > 0
        ? args.targets
        : [args.target ?? ''];
      const targets = [...new Set(rawTargets.map(resolveTarget))];
      if (targets.length > 20) throw new Error('单次最多广播到 20 个会话');
      const config = state.config;
      const replyCfg = config.reply ?? {};
      let messages = normalizeMessages(args.messages);
      if (replyCfg.stripMarkdown !== false) messages = messages.map((m) => stripMarkdown(m));
      const maxChars = Math.max(200, Number(replyCfg.maxChars) || 1500);
      const chunks = messages.flatMap((message) => splitText(message, maxChars)).slice(0, 20);
      if (chunks.length === 0) throw new Error('messages 为空');
      const results = [];
      for (const targetKey of targets) {
        try {
          const result = await pool.channelManager.sendKey(targetKey, chunks);
          // Only a successful send to THIS conversation suppresses its final
          // assistant text; a failed send falls back to auto-reply, and a push
          // to another conversation must not swallow the reply to the current user.
          if (targetKey === key) pool.markTurnSent(key);
          results.push({ target: targetKey, ok: true, resultCount: Array.isArray(result) ? result.length : 1 });
        } catch (error) {
          results.push({ target: targetKey, ok: false, error: String(error?.message ?? error) });
        }
      }
      const okCount = results.filter((item) => item.ok).length;
      if (okCount === 0) throw new Error(`发送失败：${results.map((item) => `${item.target}: ${item.error}`).join('；')}`);
      logger?.debug?.(`[lane-bridge] lane_send ${key} -> ${targets.join(', ')}: ${chunks.length} 条（${okCount}/${targets.length}）`);
      return { ok: true, targets, sent: chunks.length, results };
    },
    {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        targets: { type: 'array', items: { type: 'string' } },
        sent: { type: 'number' },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              target: { type: 'string' },
              ok: { type: 'boolean' },
              resultCount: { type: 'number' },
              error: { type: 'string' },
            },
            required: ['target', 'ok'],
          },
        },
      },
      required: ['ok'],
    }
  );

  const laneInfo = define(
    'lane_conversation_info',
    '查看当前会话的绑定状态、领域、角色卡、知识库范围和可用宿主工具。回复用户前不确定自己是谁/能用什么时调用。',
    { type: 'object', properties: {}, additionalProperties: false },
    async () => {
      const state = getState();
      const resolved = resolveConversation(state, key);
      return {
        key,
        label: conversationLabel(state, key),
        bound: resolved.bound,
        domain: resolved.domain ? { id: resolved.domain.id, name: resolved.domain.name } : null,
        role: resolved.role,
        preset: resolved.preset,
        model: resolved.model,
        knowledgeScopes: resolved.knowledgeScopes,
        allowedHostTools: resolved.allowedHostTools,
        autoReply: resolved.autoReply,
        sessionId: state.sessions?.[key]?.sessionId ?? '',
      };
    },
    {
      type: 'object',
      properties: {
        key: { type: 'string' },
        label: { type: 'string' },
        bound: { type: 'boolean' },
        role: { type: 'string' },
        preset: { type: 'string' },
        model: { type: 'string' },
        knowledgeScopes: { type: 'array', items: { type: 'string' } },
        allowedHostTools: { type: 'array', items: { type: 'string' } },
        autoReply: { type: 'boolean' },
        sessionId: { type: 'string' },
      },
      required: ['key', 'bound'],
    }
  );

  const kbList = define(
    'lane_kb_list',
    '列出当前领域可用的知识库文档（共享知识库，按 scope 分目录）。不知道有哪些文档时先调它。',
    {
      type: 'object',
      properties: {
        scope: { type: 'string', description: '可选：只看某个知识库 scope' },
      },
      additionalProperties: false,
    },
    async (args) => {
      const resolved = currentResolved();
      const scopes = args.scope ? [String(args.scope)] : resolved.knowledgeScopes;
      return listKnowledge(knowledgeDir, scopes);
    },
    {
      type: 'object',
      properties: {
        scopes: { type: 'array', items: { type: 'string' } },
        selected: { type: 'array', items: { type: 'string' } },
        count: { type: 'number' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              scope: { type: 'string' },
              path: { type: 'string' },
              size: { type: 'number' },
            },
            required: ['scope', 'path'],
          },
        },
      },
      required: ['count', 'files'],
    }
  );

  const kbRead = define(
    'lane_kb_read',
    '读知识库里的一篇文档（.md/.txt）。path 可以是「scope/文件.md」或「文件.md」（后者在领域选中的 scope 里找）。返回纯文本，过长会截断。',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: '知识库内相对路径，例如 default/常见问题.md' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    async (args) => {
      const resolved = currentResolved();
      const result = readKnowledge(knowledgeDir, resolved.knowledgeScopes, args.path);
      if (!result.ok) throw new Error(result.message);
      return result;
    },
    {
      type: 'object',
      properties: {
        scope: { type: 'string' },
        path: { type: 'string' },
        chars: { type: 'number' },
        truncated: { type: 'boolean' },
        content: { type: 'string' },
      },
      required: ['scope', 'path', 'content'],
    }
  );

  const kbSearch = define(
    'lane_kb_search',
    '在知识库里按关键词搜索（多词用空格分隔，全部命中才算）。返回命中的文件、小节标题与片段。',
    {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词，例如 存档 迁移' },
        limit: { type: 'number', description: '最多返回多少条，默认 8，最大 30' },
        scope: { type: 'string', description: '可选：只搜某个 scope' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async (args) => {
      const resolved = currentResolved();
      const scopes = args.scope ? [String(args.scope)] : resolved.knowledgeScopes;
      const result = searchKnowledge(knowledgeDir, scopes, args.query, args.limit);
      if (!result.ok) throw new Error(result.message);
      return result;
    },
    {
      type: 'object',
      properties: {
        query: { type: 'string' },
        count: { type: 'number' },
        hits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              scope: { type: 'string' },
              path: { type: 'string' },
              heading: { type: 'string' },
              snippet: { type: 'string' },
            },
            required: ['scope', 'path', 'snippet'],
          },
        },
      },
      required: ['query', 'count', 'hits'],
    }
  );

  const kbDraft = define(
    'lane_kb_draft',
    '把这次查清、且现有知识库没有覆盖的结论写成知识库草稿。草稿不会立刻生效，管理员在 Settings → IM 桥接 → 知识库审批 中采纳后才会进入正式知识库；未采纳前不参与检索。必须写来源。',
    {
      type: 'object',
      properties: {
        title: { type: 'string', description: '一句话标题，用用户会说的词，例如「存档位置在哪」' },
        content: { type: 'string', description: '可直接作为答复口径的正文，2~5 条要点，<=2000 字' },
        source: { type: 'string', description: '来源：commit / 文件 / issue / 群反馈，例如 commit f179be46 或 issue #4' },
        scope: { type: 'string', description: '可选：目标知识库 scope；省略=当前领域第一个 scope' },
      },
      required: ['title', 'content', 'source'],
      additionalProperties: false,
    },
    async (args) => {
      const resolved = currentResolved();
      if (resolved.kbDraftEnabled === false) throw new Error('当前领域未开启知识库草稿');
      const scope = String(args.scope ?? resolved.knowledgeScopes?.[0] ?? 'default').trim();
      if (!resolved.knowledgeScopes.includes(scope)) throw new Error(`scope 不在当前领域知识库范围内：${scope}`);
      const draft = writeDraft(knowledgeDir, scope, args);
      return {
        ok: true,
        duplicate: draft.duplicate === true,
        scope: draft.scope,
        file: draft.file,
        title: draft.title,
        note: draft.duplicate
          ? '同样的草稿已经存在，等管理员审核即可，不要重复起草'
          : '草稿已写入待审区；管理员采纳后才会生效。回复用户时不要提草稿流程。',
      };
    },
    {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        duplicate: { type: 'boolean' },
        scope: { type: 'string' },
        file: { type: 'string' },
        title: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['ok', 'scope', 'file'],
    }
  );

  function requireRepo() {
    const resolved = currentResolved();
    if (resolved.repoEnabled !== true) throw new Error('当前领域未开启 GitHub 仓库读取：在 Settings → IM 桥接 → 领域里勾选「允许读取 GitHub 仓库」');
    if (!repo) throw new Error('GitHub 仓库模块不可用');
    const scoped = typeof repo.forRepo === 'function'
      ? repo.forRepo({ repo: resolved.repo, branch: resolved.repoBranch })
      : repo;
    const status = typeof scoped.status === 'function' ? scoped.status(false) : null;
    if (status && !status.repoConfigured) {
      throw new Error('当前领域没有可用的 GitHub 仓库：在 Settings → IM 桥接 → 领域里填写仓库，或留空继承全局仓库');
    }
    return scoped;
  }

  const repoStatus = define(
    'lane_repo_status',
    '查看当前 GitHub 仓库连接状态：绑定了哪个仓库、凭据来源、是否允许建 issue。不返回 token。',
    { type: 'object', properties: {}, additionalProperties: false },
    async () => {
      const client = requireRepo();
      return client.status(true);
    }
  );

  const repoIssues = define(
    'lane_repo_list_issues',
    '列仓库 issue（默认 open）。用于判断有没有人报过同样的问题；可用关键词走 issue 搜索。',
    {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: '默认 open' },
        query: { type: 'string', description: '可选关键词' },
        labels: { type: 'string', description: '可选标签，逗号分隔' },
        limit: { type: 'number', description: '默认 15，最大 30' },
      },
      additionalProperties: false,
    },
    async (args) => requireRepo().listIssues(args)
  );

  const repoIssue = define(
    'lane_repo_get_issue',
    '读某条 issue 的正文与最近评论。知道编号时用它，比列表更省上下文。',
    {
      type: 'object',
      properties: {
        number: { type: 'number', description: 'issue 编号' },
        comments: { type: 'number', description: '评论条数，默认 10' },
        commentChars: { type: 'number', description: '每条评论最多字符，默认 800' },
      },
      required: ['number'],
      additionalProperties: false,
    },
    async (args) => requireRepo().getIssue(args)
  );

  const repoSearch = define(
    'lane_repo_search_code',
    '在仓库代码里搜索（需要 GitHub token）。用于「这个报错文案/函数名在代码哪里」；返回文件路径和片段，不返回整文件。',
    {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索词' },
        path: { type: 'string', description: '可选：限定目录前缀，例如 src/' },
        limit: { type: 'number', description: '默认 10，最大 20' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async (args) => requireRepo().searchCode(args)
  );

  const repoRead = define(
    'lane_repo_read_file',
    '读仓库里的单个文件（仓库内相对路径，默认分支）。超过上限会截断；不能读仓库外文件。',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: '仓库内相对路径，例如 src/index.js' },
        ref: { type: 'string', description: '可选：分支/标签/提交 sha' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    async (args) => requireRepo().readFile(args)
  );

  const repoCommits = define(
    'lane_repo_recent_commits',
    '看仓库最近提交（谁、什么时候、改了什么）。用于判断最近是不是有改动导致 bug。',
    {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '提交条数，默认 15' },
        path: { type: 'string', description: '可选：只看某个路径/目录' },
        since: { type: 'string', description: '可选：ISO 时间' },
      },
      additionalProperties: false,
    },
    async (args) => requireRepo().recentCommits(args)
  );

  const repoCreateIssue = define(
    'lane_repo_create_issue',
    '在仓库新建 issue（默认关闭，需管理员开启）。只在问题已经定位清楚、用户也确认后使用；会自动带标记标签。',
    {
      type: 'object',
      properties: {
        title: { type: 'string', description: '一句话说清现象' },
        body: { type: 'string', description: '复现步骤、预期/实际、版本、日志片段' },
        labels: { type: 'string', description: '可选附加标签，逗号分隔' },
      },
      required: ['title', 'body'],
      additionalProperties: false,
    },
    async (args) => requireRepo().createIssue(args)
  );

  const memoryRead = define(
    'lane_memory_read',
    '读取当前领域的共享记忆（跨会话积累的经验/背景）。不确定之前是否记录过时先查。',
    { type: 'object', properties: {}, additionalProperties: false },
    async () => {
      const resolved = currentResolved();
      if (!resolved.memoryEnabled || !memoryStore) {
        return { enabled: false, domainId: resolved.domain?.id ?? '', count: 0, text: '' };
      }
      const data = memoryStore.load(resolved.domain.id);
      return {
        enabled: true,
        domainId: resolved.domain.id,
        count: data.entries.length,
        text: memoryStore.render(resolved.domain.id, resolved.memoryMaxChars),
      };
    },
    {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        domainId: { type: 'string' },
        count: { type: 'number' },
        text: { type: 'string' },
      },
      required: ['enabled', 'count'],
    }
  );

  const memoryAdd = define(
    'lane_memory_add',
    '向当前领域的共享记忆追加一条短事实/经验（<=500 字）。适合记：用户反复报的问题、已确认的环境、有效的临时方案。不要记隐私、凭据、一次性闲聊。',
    {
      type: 'object',
      properties: {
        text: { type: 'string', description: '一条可复用的事实/经验，<=500 字' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    async (args) => {
      const resolved = currentResolved();
      if (!resolved.memoryEnabled || !memoryStore) throw new Error('当前领域未启用共享记忆');
      const result = memoryStore.append(resolved.domain.id, args.text, { source: `agent:${key}` });
      return { ok: true, domainId: resolved.domain.id, count: result.entries };
    },
    {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        domainId: { type: 'string' },
        count: { type: 'number' },
      },
      required: ['ok'],
    }
  );

  const laneEscalate = define(
    'lane_escalate',
    '把当前会话转人工：暂停自动回复，并通知管理员配置的接管会话。只在用户明确要求人工、或你确实无法解决且继续猜会误导用户时使用。调用后告诉用户已转人工，不要再继续给方案。',
    {
      type: 'object',
      properties: {
        reason: { type: 'string', description: '简短原因，例如：用户要求人工 / 需要查后台数据' },
        summary: { type: 'string', description: '给客服的上下文摘要：用户问题、已确认信息、已尝试方案' },
      },
      additionalProperties: false,
    },
    async (args) => {
      const result = await pool.escalate(key, {
        reason: String(args.reason ?? ''),
        summary: String(args.summary ?? ''),
      });
      // The generic ack already spoke to the user; do not append the final
      // assistant text as a second "已转人工" bubble. If no ack is configured,
      // the normal final-text path still works.
      if (result.ackSent) pool.markTurnSent(key);
      return { ok: true, ...result };
    },
    {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        paused: { type: 'boolean' },
        notified: { type: 'boolean' },
        ackSent: { type: 'boolean' },
        targetKey: { type: 'string' },
      },
      required: ['ok', 'paused'],
    }
  );

  return [
    laneSend, laneInfo, kbList, kbRead, kbSearch, kbDraft,
    repoStatus, repoIssues, repoIssue, repoSearch, repoRead, repoCommits, repoCreateIssue,
    memoryRead, memoryAdd, laneEscalate,
  ];
}

export const LANE_TOOL_NAMES = [
  'lane_send', 'lane_conversation_info', 'lane_kb_list', 'lane_kb_read', 'lane_kb_search', 'lane_kb_draft',
  'lane_repo_status', 'lane_repo_list_issues', 'lane_repo_get_issue', 'lane_repo_search_code',
  'lane_repo_read_file', 'lane_repo_recent_commits', 'lane_repo_create_issue',
  'lane_memory_read', 'lane_memory_add', 'lane_escalate',
];
