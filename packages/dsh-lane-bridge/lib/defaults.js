// Defaults and seed content for dsh-lane-bridge.
//
// This module is intentionally dependency-free: the tests and the Settings card
// both rely on it, and the plugin should be inspectable without running DSH.

export const STATE_VERSION = 1;

// Attention policies for group chats. `all` and `off` are exclusive; the rest
// combine (mention OR keyword), because "answer when @ed, and also when someone
// asks a support question" is the normal support-desk requirement.
export const TRIGGER_MODES = ['all', 'mention', 'keyword', 'off'];

/**
 * Canonical trigger list. Accepts an array (new shape) or a single value (old
 * shape, still written by older clients) and always returns a non-empty list in
 * a stable order.
 */
export function normalizeTriggers(input) {
  const raw = Array.isArray(input) ? input : [input];
  const picked = new Set();
  for (const value of raw) {
    const mode = String(value ?? '').trim();
    if (TRIGGER_MODES.includes(mode)) picked.add(mode);
  }
  if (picked.size === 0) return ['all'];
  if (picked.has('off')) return ['off'];
  if (picked.has('all')) return ['all'];
  return TRIGGER_MODES.filter((mode) => picked.has(mode));
}

export function conversationKey(channel, kind, externalId) {
  const c = String(channel ?? '').trim();
  const k = kind === 'private' ? 'private' : 'group';
  const id = String(externalId ?? '').trim();
  if (!c || !id) throw new TypeError('conversationKey requires channel and externalId');
  return `${c}:${k}:${id}`;
}

export function parseConversationKey(key) {
  const m = /^([^:]+):(group|private):(.+)$/u.exec(String(key ?? ''));
  if (!m) return null;
  return { channel: m[1], kind: m[2], externalId: m[3], key: `${m[1]}:${m[2]}:${m[3]}` };
}

export function defaultConfig() {
  return {
    enabled: true,
    defaultDomainId: 'default',
    // Unbound conversations are recorded but never prompt an agent. These two
    // switches are an explicit opt-in for a support inbox that should answer
    // strangers immediately.
    autoReplyPrivate: false,
    autoReplyGroups: false,
    pushToken: '',
    reply: {
      maxChars: 1500,
      stripMarkdown: true,
      chunkDelayMs: 250,
      // Merge a burst of chat messages into one prompt. 0 disables debouncing.
      debounceMs: 800,
    },
    handoff: {
      enabled: true,
      targetKey: '',
      ackMessage: '已转人工，客服稍后回复你。',
    },
    media: {
      enabled: true,
      maxBytes: 8 * 1024 * 1024,
      maxCount: 4,
      timeoutMs: 15000,
    },
    github: {
      enabled: false,
      repo: '',
      token: '',
      branch: '',
      allowCreateIssue: false,
      issueLabel: 'agent',
      maxCreatesPerHour: 3,
      maxFileChars: 20000,
    },
    channels: {
      snowluma: {
        enabled: true,
        wsUrl: 'ws://127.0.0.1:3001',
        accessToken: '',
        homeDir: '',
      },
      qqbot: {
        enabled: false,
        appId: '',
        appSecret: '',
      },
      discord: {
        enabled: false,
        token: '',
        requireMention: false,
      },
    },
  };
}

export function defaultDomain() {
  return {
    id: 'default',
    name: '默认客服',
    role: '客服',
    preset: 'lane-support',
    model: '',
    knowledgeScopes: ['default'],
    allowedHostTools: [],
    autoReply: true,
    trigger: 'all',
    triggers: ['all'],
    keywords: [],
    memoryEnabled: false,
    memoryMaxChars: 2000,
    kbDraftEnabled: true,
    repoEnabled: false,
    repo: '',
    branch: '',
    systemPrompt: '',
    maxReplyChars: 0,
  };
}

export function sampleRoleCard() {
  return `# 角色卡：通用客服

## 你是谁

你是这个产品/社区的客服助手，在即时通讯里接待用户。

- 你代表团队，不代表自己；不打造个人设，不玩梗、不卖萌、不阴阳。
- 你的目标是**把问题解决掉或推进下去**，不是把话说漂亮。
- 你不是开发者，也不必假装无所不知：定位不到的就说「我需要再确认」。

## 说话方式

- 一条 1~3 行，复杂问题用「1）2）3）」分条。
- 不用 Markdown（\`**\`、\`#\`、代码块在聊天软件里会显示成乱码）。
- 一次道歉足够，别每句都「非常抱歉」；重点在解决。
- 不承诺时间点，只承诺动作。

## 处理问题的顺序

1. **接住**：一句话复述你理解的问题。
2. **要信息**：一次只问 2~3 个最关键的（版本、平台、报错原文、复现步骤）。
3. **查**：先查知识库，再回答；查不到就说没查到。
4. **给结论**：一句判断、一句依据、一句下一步。
5. **收尾**：确认还有没有别的问题。

## 边界

- 不透露本机路径、内部配置、令牌、其他用户的信息。
- 不贴整段源码；只给必要的纯文本片段。
- 不承诺上线时间，不评价团队内部优先级。
- 用户要求你执行命令/改文件/装软件时，说明需要管理员处理。
`;
}

export function sampleKnowledge() {
  return {
    'default/产品概述.md': `# 产品概述

> 这是知识库示例。把它替换成你自己产品的口径。

## 一句话

（产品是什么、面向谁、核心玩法/功能是什么。）

## 主要模块

| 模块 | 用户会怎么描述 | 备注 |
| --- | --- | --- |
| 示例模块 | 「那个功能」 | 待补充 |
`,
    'default/常见问题.md': `# 常见问题

## 存档位置在哪？

（填写各平台的存档路径或说明。）

## 支持联机吗？

（填写支持情况。）

## 遇到 bug 怎么反馈？

请提供：版本号、平台、报错原文、复现步骤。
`,
    'default/排障手册.md': `# 排障手册

## 进不去 / 闪退

1. 确认版本号与平台。
2. 让用户提供报错原文或截图里的文字。
3. 检查是否为已知 issue。

## 卡住 / 没反应

1. 确认是否必现、从什么时候开始。
2. 让用户尝试重启并复现一次。
`,
  };
}

export function defaultState() {
  const role = sampleRoleCard();
  return {
    version: STATE_VERSION,
    revision: 0,
    config: defaultConfig(),
    domains: [defaultDomain()],
    roles: [{ name: '客服', content: role, updatedAt: 0 }],
    bindings: {},
    conversations: {},
    sessions: {},
  };
}

export const MODEL_PRESET_CHOICES = ['lane-support'];
