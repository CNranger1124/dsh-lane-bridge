// Pure conversation/domain resolution. No fs, no DSH, no timers: the host and
// the tests share exactly one implementation.
import { isOperatorId, normalizeOperators, normalizeTriggers, parseConversationKey } from './defaults.js';
import { renderTemplate } from './template.js';

export function findDomain(state, id) {
  const domains = Array.isArray(state?.domains) ? state.domains : [];
  return domains.find((domain) => domain.id === id) ?? domains[0] ?? null;
}

export function bindingFor(state, key) {
  const binding = state?.bindings?.[key];
  return binding && binding.enabled !== false ? binding : null;
}

export function findRole(state, name) {
  const roles = Array.isArray(state?.roles) ? state.roles : [];
  const wanted = String(name ?? '').trim();
  if (!wanted) return null;
  return roles.find((role) => role.name === wanted) ?? null;
}

/**
 * Resolve the effective policy for one conversation.
 *
 * Model: conversation → role → domain. The conversation names a role card, the
 * role names its domain, and the domain owns the infrastructure (knowledge
 * scopes, shared memory, repo, operators, attention policy). `domainId` on a
 * binding is only read for state written before 0.4.0.
 *
 * A domain may also claim a bot (`domain.channelId`): conversations on that bot
 * that nobody bound fall into that domain instead of the global default. That is
 * what lets one deployment run one bot per project (0.8.0). An explicit role
 * binding still wins.
 *
 * @returns {{
 *   key: string, channel: string, channelDomainId: string,
 *   bound: boolean, domain: object|null,
 *   role: string, preset: string, model: string,
 *   knowledgeScopes: string[], allowedHostTools: string[],
 *   autoReply: boolean, maxReplyChars: number,
 *   repo: string, repoBranch: string,
 *   source: 'binding'|'domain'|'default'|'unbound'
 * }}
 */
export function resolveConversation(state, key) {
  const parsed = parseConversationKey(key);
  if (!parsed) throw new TypeError(`invalid conversation key: ${key}`);
  const binding = bindingFor(state, key);
  const defaultDomain = findDomain(state, state?.config?.defaultDomainId);
  // The domain that claims this bot (`domain.channelId`). Strict lookup: when
  // the id is stale we want "no claim", not "the first domain in the list".
  const channelDomain = (Array.isArray(state?.domains) ? state.domains : [])
    .find((domain) => domain?.channelId && domain.channelId === parsed.channel) ?? null;
  // An explicit role binding always wins. Only when nothing is bound does the
  // bot's owner decide the domain — otherwise the global `defaultRole` would
  // pull every conversation on every bot into the same domain.
  const roleName = String(binding?.role || (channelDomain ? '' : state?.config?.defaultRole) || '').trim();
  const legacyDomainId = String(binding?.domainId ?? '').trim();
  let role = findRole(state, roleName);
  const domain = role?.domainId
    ? findDomain(state, role.domainId)
    : legacyDomainId
      ? findDomain(state, legacyDomainId)
      : (channelDomain ?? defaultDomain);
  // No explicit role: use the first card that belongs to the resolved domain, so
  // the persona and the infrastructure never disagree.
  if (!role) {
    const roles = Array.isArray(state?.roles) ? state.roles : [];
    role = roles.find((item) => item.domainId === domain?.id) ?? roles[0] ?? null;
  }
  const unbound = !binding;
  // An unbound conversation follows the switches unless a domain *owns* this
  // bot: then the bot is that project's front desk, and its groups answer under
  // the domain's own policy (the `autoReplyGroups/Private` switches remain the
  // opt-in for bots nobody claims).
  const autoReply = binding || channelDomain
    ? domain?.autoReply !== false
    : parsed.kind === 'private'
      ? state?.config?.autoReplyPrivate === true
      : state?.config?.autoReplyGroups === true;
  const triggers = normalizeTriggers(domain?.triggers ?? domain?.trigger);
  return {
    key,
    channel: parsed.channel,
    channelDomainId: channelDomain?.id ?? '',
    bound: !unbound,
    domain: domain ?? null,
    role: String(role?.name || '客服'),
    preset: String(binding?.preset || domain?.preset || 'lane-support'),
    model: String(binding?.model || domain?.model || ''),
    knowledgeScopes: Array.isArray(domain?.knowledgeScopes) && domain.knowledgeScopes.length > 0
      ? domain.knowledgeScopes
      : ['default'],
    trigger: triggers[0],
    triggers,
    keywords: Array.isArray(domain?.keywords) ? domain.keywords : [],
    memoryEnabled: domain?.memoryEnabled === true,
    memoryMaxChars: Math.max(200, Math.min(8000, Number(domain?.memoryMaxChars) || 2000)),
    kbDraftEnabled: domain?.kbDraftEnabled !== false,
    kbAutoRetrieve: domain?.kbAutoRetrieve === true,
    kbTriggerKeywords: Array.isArray(domain?.kbTriggerKeywords) && domain.kbTriggerKeywords.length > 0
      ? domain.kbTriggerKeywords
      : (Array.isArray(domain?.keywords) ? domain.keywords : []),
    kbRetrieveChars: Math.max(200, Math.min(8000, Number(domain?.kbRetrieveChars) || 1500)),
    sessionMaxTurns: Math.max(0, Math.min(1000, Number(domain?.sessionMaxTurns) || 0)),
    repoEnabled: domain?.repoEnabled === true,
    repo: String(domain?.repo || state?.config?.github?.repo || '').trim(),
    repoBranch: String(domain?.branch || state?.config?.github?.branch || '').trim(),
    allowedHostTools: Array.isArray(domain?.allowedHostTools) ? domain.allowedHostTools : [],
    operators: normalizeOperators(domain?.operators),
    autoReply: autoReply && domain?.autoReply !== false,
    paused: binding?.paused === true,
    maxReplyChars: Number(binding?.maxReplyChars) > 0
      ? Number(binding.maxReplyChars)
      : Number(domain?.maxReplyChars) > 0
        ? Number(domain.maxReplyChars)
        : Number(state?.config?.reply?.maxChars) || 1500,
    source: binding ? 'binding' : 'unbound',
  };
}

/** A conversation is eligible for a model call only when it resolves to a domain AND auto-reply is on. */
export function canReply(state, key) {
  const resolved = resolveConversation(state, key);
  return Boolean(resolved.domain) && resolved.autoReply === true && resolved.paused !== true;
}

/**
 * Whether this particular inbound message should wake the agent.
 *
 * `autoReply` is the conversation-level switch; `triggers` is the per-domain
 * attention policy. Several policies combine with OR: a support desk usually
 * wants "answer when @ed, and also when someone asks a support question".
 * `all` and `off` are exclusive. Private chats have nothing to be mentioned in,
 * so they answer unless the domain is switched off.
 */
export function shouldTrigger(state, key, inbound) {
  const resolved = resolveConversation(state, key);
  if (!resolved.domain || resolved.autoReply !== true) return false;
  const kind = inbound?.kind === 'private' ? 'private' : 'group';
  const triggers = resolved.triggers;
  if (triggers.includes('off')) return false;
  if (kind === 'private') return true;
  if (triggers.includes('all')) return true;
  if (triggers.includes('mention') && (inbound?.mentionsBot === true || inbound?.replyToBot === true)) return true;
  if (triggers.includes('keyword')) {
    const text = String(inbound?.text ?? '').toLowerCase();
    if (resolved.keywords.some((word) => text.includes(String(word).toLowerCase()))) return true;
  }
  return false;
}

/**
 * Whether this sender is a declared administrator of the conversation's domain.
 * The whitelist lives on the domain (`operators`), so every group/private chat
 * bound to that domain shares it, and an empty list means "nobody".
 */
export function isOperator(state, key, senderId) {
  const parsed = parseConversationKey(key);
  const resolved = resolveConversation(state, key);
  return isOperatorId(resolved.operators, parsed?.channel ?? '', senderId);
}

export function roleContent(state, name) {
  const roles = Array.isArray(state?.roles) ? state.roles : [];
  return roles.find((role) => role.name === name)?.content ?? '';
}

export function conversationLabel(state, key) {
  const convo = state?.conversations?.[key];
  if (convo?.name) return convo.name;
  const parsed = parseConversationKey(key);
  if (!parsed) return key;
  const channelLabel = String(state?.config?.channels?.[parsed.channel]?.label ?? '').trim() || parsed.channel;
  return `${channelLabel} ${parsed.kind === 'private' ? '私聊' : '群聊'} ${parsed.externalId}`;
}

/** Render the first-turn context: domain + role card + channel facts. */
export function buildContextPrefix({
  resolved, roleText, memoryText, kbText, channel, kind, externalId, senderName, senderId, senderIsOperator,
}) {
  const isGroup = kind !== 'private';
  // Everything a role card / domain prompt may branch on. Rendered once here so
  // both text sources see exactly the same view of "who is speaking".
  const templateContext = {
    operator: senderIsOperator === true,
    group: isGroup,
    private: !isGroup,
    identity: senderIsOperator === true ? '管理员' : '普通成员',
    sender: senderName || '',
    senderId: senderId || '',
    channel: channel || '',
    kind: isGroup ? '群聊' : '私聊',
    externalId: externalId || '',
    domain: resolved?.domain?.name ?? '',
    role: resolved?.role ?? '',
  };
  const lines = [];
  lines.push('【IM 会话】');
  lines.push(`渠道：${channel}；类型：${isGroup ? '群聊' : '私聊'}；会话 id：${externalId}`);
  if (senderName) lines.push(`本次发言者：${senderName}${senderIsOperator ? '（本领域管理员，可执行管理操作）' : ''}`);
  lines.push(`发言者身份：${templateContext.identity}`);
  if (resolved?.domain?.name) lines.push(`当前领域：${resolved.domain.name}`);
  if (resolved?.domain?.systemPrompt) {
    lines.push('');
    lines.push('【领域附加说明】');
    lines.push(renderTemplate(String(resolved.domain.systemPrompt), templateContext).trim());
  }
  if (memoryText) {
    lines.push('');
    lines.push('【领域共享记忆】');
    lines.push('（可能过期的经验/背景，不是产品口径；与知识库冲突时以知识库为准）');
    lines.push(String(memoryText).trim());
  }
  if (kbText) {
    lines.push('');
    lines.push('【知识库命中（按关键词自动检索）】');
    lines.push('（现有文档的原文片段，可直接引用；需要更多再调 lane_kb_search / lane_kb_read）');
    lines.push(String(kbText).trim());
  }
  if (roleText) {
    lines.push('');
    lines.push(`【角色卡：${resolved?.role ?? ''}】`);
    lines.push(renderTemplate(String(roleText), templateContext).trim());
  }
  lines.push('');
  lines.push('【用户消息】');
  return `${lines.join('\n')}\n`;
}

export function formatInboundText({ text, senderName, kind, externalId, channel }) {
  const who = kind === 'group' ? `${senderName || '群友'}` : '用户';
  const head = `[${channel} ${kind === 'group' ? '群' : '私聊'} ${externalId}] ${who}：`;
  return `${head}${String(text ?? '').trim()}`;
}
