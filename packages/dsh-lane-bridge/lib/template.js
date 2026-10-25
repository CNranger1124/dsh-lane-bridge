// Tiny, dependency-free template renderer for role cards and domain prompts.
//
// Role cards are static Markdown, but the same role serves administrators and
// ordinary members in one group. Two constructs cover that need without
// inventing a language:
//
//   {{sender}} … {{identity}} … {{channel}}       variable interpolation
//   {{#if operator}}A{{else}}B{{/if}}             one conditional block
//
// Deliberately NOT supported: nesting, loops, expressions, filters. A support
// role card is prose, and anything more clever becomes unreadable in the
// settings textarea. Unknown variables render as an empty string (never the
// literal `{{x}}`), so a typo degrades to "missing sentence", not to garbage in
// the prompt.

const BLOCK_RE = /\{\{#if\s+([a-zA-Z][\w]*)\s*\}\}([\s\S]*?)\{\{\/if\}\}/gu;
const VAR_RE = /\{\{\s*([a-zA-Z][\w]*)\s*\}\}/gu;

/** True when the text contains anything the renderer would act on. */
export function hasTemplate(text) {
  return typeof text === 'string' && text.includes('{{');
}

function isTruthy(condition, ctx) {
  const value = ctx?.[condition];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value !== '' && value !== 'false' && value !== '0';
  return false;
}

/**
 * Render a role card / prompt fragment.
 *
 * @param {string} text
 * @param {object} ctx  variable name → value; booleans work as conditions
 * @returns {string}
 */
export function renderTemplate(text, ctx = {}) {
  const source = String(text ?? '');
  if (!source.includes('{{')) return source;

  // Blocks first: `{{else}}` would otherwise be mistaken for a variable.
  const withoutBlocks = source.replace(BLOCK_RE, (_match, condition, body) => {
    const split = body.split(/\{\{\s*else\s*\}\}/u);
    const yes = split[0] ?? '';
    const no = split.slice(1).join('{{else}}');
    return isTruthy(condition, ctx) ? yes : no;
  });

  return withoutBlocks.replace(VAR_RE, (_match, name) => {
    const value = ctx?.[name];
    if (value === undefined || value === null || typeof value === 'object') return '';
    if (typeof value === 'boolean') return value ? '是' : '否';
    return String(value);
  });
}

/**
 * Documented vocabulary, rendered into the Settings hint so the syntax lives
 * next to the input instead of only in the README.
 */
export const TEMPLATE_VARIABLES = [
  ['identity', '管理员 / 普通成员'],
  ['sender', '昵称'],
  ['senderId', '渠道给出的用户 id'],
  ['channel', 'snowluma / qqbot / discord'],
  ['kind', '群聊 / 私聊'],
  ['externalId', '群号或用户 id'],
  ['domain', '领域名'],
  ['role', '角色卡名'],
];

export const TEMPLATE_CONDITIONS = ['operator', 'group', 'private'];
