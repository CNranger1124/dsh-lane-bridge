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

// ---------------------------------------------------------------------------
// Operator (bot administrator) whitelist.
//
// One entry = one person. The accepted shapes are deliberately few, because the
// value has to be copy-pasteable from the Conversations table:
//
//   `*`                            everyone (explicit opt-in to "trust the room")
//   `snowluma:123456789`           channel + platform user id
//   `qqbot:8FD96C63927394130884...` channel + openid
//   `discord:123456789012345678`   channel + snowflake
//   `123456789`                    channel-less: matches that id on any channel
//
// The channel part is the same token that starts a conversation key
// (`snowluma:group:...` → `snowluma`). The user part is *the sender id the
// channel adapter reports* — QQ number for SnowLuma, openid for the official
// QQ Bot, snowflake for Discord. Never a nickname: nicknames are not unique and
// can be changed by anyone.
// ---------------------------------------------------------------------------

export const OPERATOR_ALL = '*';
// Channel prefix: same alphabet the conversation key allows. User part: any
// non-space run without a colon (openids, QQ numbers, snowflakes, emails).
const OPERATOR_RE = /^(?:\*|[a-z0-9_-]{1,20}:[^\s:]{1,120}|[^\s:]{1,120})$/iu;

/** Canonical operator list: trimmed, de-duplicated (case-insensitive), capped. */
export function normalizeOperators(input) {
  const raw = Array.isArray(input) ? input : [];
  const seen = new Map();
  for (const value of raw) {
    const text = String(value ?? '').trim().replace(/^@+/u, '');
    if (!text || !OPERATOR_RE.test(text)) continue;
    const key = text.toLowerCase();
    if (!seen.has(key)) seen.set(key, text);
    if (seen.size >= 50) break;
  }
  return [...seen.values()];
}

/** Does one whitelist entry match this sender? */
export function operatorMatches(entry, channel, senderId) {
  const value = String(entry ?? '').trim();
  const id = String(senderId ?? '').trim();
  if (!value || !id) return false;
  if (value === OPERATOR_ALL) return true;
  const colon = value.indexOf(':');
  if (colon > 0) {
    const wantChannel = value.slice(0, colon).toLowerCase();
    if (wantChannel !== String(channel ?? '').trim().toLowerCase()) return false;
    return value.slice(colon + 1).toLowerCase() === id.toLowerCase();
  }
  return value.toLowerCase() === id.toLowerCase();
}

/** Whitelist check. An empty list means "nobody", not "everybody". */
export function isOperatorId(operators, channel, senderId) {
  const list = Array.isArray(operators) ? operators : [];
  return list.some((entry) => operatorMatches(entry, channel, senderId));
}

/**
 * The canonical string the Settings card asks the operator to paste, built from
 * what an adapter actually reported.
 */
export function operatorEntryFor(channel, senderId) {
  const c = String(channel ?? '').trim();
  const id = String(senderId ?? '').trim();
  if (!id) return '';
  return c ? `${c}:${id}` : id;
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
    // Fallback for a conversation that has not picked a role yet. Roles carry
    // the domain binding, so this is only a convenience default.
    defaultRole: '',
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
        // QQ: passive replies carry msg_id (valid 5 minutes, ≤5 replies per
        // message); active messages are rate-limited (60 qpm certified / 30 qpm
        // otherwise, 20 qpm per relationship, 1000/day per group) and a bot
        // without the permission gets 40034105. So sending without msg_id stays
        // opt-in.
        allowActive: false,
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
    // A domain owns infrastructure: knowledge scopes and shared memory. It no
    // longer names a role — roles point at domains, and a conversation picks a
    // role.
    preset: 'lane-support',
    model: '',
    knowledgeScopes: ['default'],
    allowedHostTools: [],
    // Strict by default: nobody is an administrator until listed. `['*']`
    // restores "trust the whole room".
    operators: [],
    autoReply: true,
    trigger: 'all',
    triggers: ['all'],
    keywords: [],
    memoryEnabled: false,
    memoryMaxChars: 2000,
    kbDraftEnabled: true,
    // Automatic knowledge retrieval: when the inbound text matches a trigger
    // word, matching document snippets are injected into the prompt. The KB is
    // never sent wholesale, and `lane_kb_*` stays available to dig further.
    kbAutoRetrieve: false,
    kbTriggerKeywords: [],
    kbRetrieveChars: 1500,
    // Retire (sediment + reset) after N answered turns. 0 = never.
    sessionMaxTurns: 0,
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
  // One flat starter document. A document is a self-contained unit with its own
  // triggers, and the operator writes as many (or as few) as the product needs.
  // Documents no longer declare domains: which domain sees a document is decided
  // by the knowledge bases that domain binds.
  return {
    'default/知识库.md': `---
title: 知识库
triggers:
---

# 知识库

> 一篇文档就是一条知识单元。在「知识库」页给它配上触发词（写在上面的 \`triggers\` 里），
> 入站消息命中其中之一时才会把这篇注入提示词。
> 这篇目前是空的，直接改写成你自己的产品口径即可。
`,
  };
}

/** Knowledge bases are named containers of documents; domains bind several. */
export function defaultKnowledgeBases() {
  return [{ id: 'default', name: '默认知识库', updatedAt: 0 }];
}

export function defaultState() {
  const role = sampleRoleCard();
  return {
    version: STATE_VERSION,
    revision: 0,
    config: defaultConfig(),
    domains: [defaultDomain()],
    // Knowledge bases live here so a domain can bind them by name in the UI.
    knowledgeBases: defaultKnowledgeBases(),
    // Conversation → role → domain. The role carries the domain binding; the
    // domain carries the infrastructure (knowledge bases, memory).
    roles: [{ name: '客服', content: role, domainId: 'default', updatedAt: 0 }],
    bindings: {},
    conversations: {},
    sessions: {},
  };
}

export const MODEL_PRESET_CHOICES = ['lane-support', 'lane-chat'];
