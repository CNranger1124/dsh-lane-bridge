// Pure conversation/domain resolution. No fs, no DSH, no timers: the host and
// the tests share exactly one implementation.
import { parseConversationKey } from './defaults.js';

export function findDomain(state, id) {
  const domains = Array.isArray(state?.domains) ? state.domains : [];
  return domains.find((domain) => domain.id === id) ?? domains[0] ?? null;
}

export function bindingFor(state, key) {
  const binding = state?.bindings?.[key];
  return binding && binding.enabled !== false ? binding : null;
}

/**
 * Resolve the effective policy for one conversation.
 *
 * @returns {{
 *   key: string, bound: boolean, domain: object|null,
 *   role: string, preset: string, model: string,
 *   knowledgeScopes: string[], allowedHostTools: string[],
 *   autoReply: boolean, maxReplyChars: number,
 *   source: 'binding'|'domain'|'default'|'unbound'
 * }}
 */
export function resolveConversation(state, key) {
  const parsed = parseConversationKey(key);
  if (!parsed) throw new TypeError(`invalid conversation key: ${key}`);
  const binding = bindingFor(state, key);
  const defaultDomain = findDomain(state, state?.config?.defaultDomainId);
  const domain = binding ? findDomain(state, binding.domainId) : defaultDomain;
  const unbound = !binding;
  const autoReply = binding
    ? domain?.autoReply !== false
    : parsed.kind === 'private'
      ? state?.config?.autoReplyPrivate === true
      : state?.config?.autoReplyGroups === true;
  return {
    key,
    bound: !unbound,
    domain: domain ?? null,
    role: String(binding?.role || domain?.role || state?.roles?.[0]?.name || '客服'),
    preset: String(binding?.preset || domain?.preset || 'lane-support'),
    model: String(binding?.model || domain?.model || ''),
    knowledgeScopes: Array.isArray(domain?.knowledgeScopes) && domain.knowledgeScopes.length > 0
      ? domain.knowledgeScopes
      : ['default'],
    trigger: String(domain?.trigger ?? 'all'),
    keywords: Array.isArray(domain?.keywords) ? domain.keywords : [],
    memoryEnabled: domain?.memoryEnabled === true,
    memoryMaxChars: Math.max(200, Math.min(8000, Number(domain?.memoryMaxChars) || 2000)),
    allowedHostTools: Array.isArray(domain?.allowedHostTools) ? domain.allowedHostTools : [],
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
 * `autoReply` is the conversation-level switch; `trigger` is the per-domain
 * attention policy. Private chats ignore `mention` (there is nothing to be
 * mentioned in) but still honor `off` and `keyword`.
 */
export function shouldTrigger(state, key, inbound) {
  const resolved = resolveConversation(state, key);
  if (!resolved.domain || resolved.autoReply !== true) return false;
  const kind = inbound?.kind === 'private' ? 'private' : 'group';
  if (resolved.trigger === 'off') return false;
  if (kind === 'private') return true;
  if (resolved.trigger === 'mention') return inbound?.mentionsBot === true || inbound?.replyToBot === true;
  if (resolved.trigger === 'keyword') {
    const text = String(inbound?.text ?? '').toLowerCase();
    return resolved.keywords.some((word) => text.includes(String(word).toLowerCase()));
  }
  return true;
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
  return `${parsed.channel} ${parsed.kind === 'private' ? '私聊' : '群聊'} ${parsed.externalId}`;
}

/** Render the first-turn context: domain + role card + channel facts. */
export function buildContextPrefix({ resolved, roleText, memoryText, channel, kind, externalId, senderName }) {
  const lines = [];
  lines.push('【IM 会话】');
  lines.push(`渠道：${channel}；类型：${kind === 'private' ? '私聊' : '群聊'}；会话 id：${externalId}`);
  if (senderName) lines.push(`本次发言者：${senderName}`);
  if (resolved?.domain?.name) lines.push(`当前领域：${resolved.domain.name}`);
  if (resolved?.domain?.systemPrompt) {
    lines.push('');
    lines.push('【领域附加说明】');
    lines.push(String(resolved.domain.systemPrompt).trim());
  }
  if (memoryText) {
    lines.push('');
    lines.push('【领域共享记忆】');
    lines.push('（可能过期的经验/背景，不是产品口径；与知识库冲突时以知识库为准）');
    lines.push(String(memoryText).trim());
  }
  if (roleText) {
    lines.push('');
    lines.push(`【角色卡：${resolved?.role ?? ''}】`);
    lines.push(String(roleText).trim());
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
