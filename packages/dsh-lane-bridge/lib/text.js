// Chat-friendly text rendering and chunking.

/** Remove the Markdown that renders as literal noise in QQ/Discord chat. */
export function stripMarkdown(text) {
  let out = String(text ?? '').replace(/\r\n/gu, '\n');
  out = out.replace(/```[^\n]*\n?([\s\S]*?)```/gu, '$1');
  out = out.replace(/`([^`\n]+)`/gu, '$1');
  out = out.replace(/!\[[^\]]*\]\(([^)]+)\)/gu, '$1');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/gu, '$1 ($2)');
  out = out.replace(/^\s{0,3}#{1,6}\s+/gmu, '');
  out = out.replace(/\*\*([^*\n]+)\*\*/gu, '$1');
  out = out.replace(/__([^_\n]+)__/gu, '$1');
  out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/gu, '$1');
  out = out.replace(/^\s*[-*+]\s+/gmu, '· ');
  out = out.replace(/^\s*>\s?/gmu, '');
  return out.replace(/\n{3,}/gu, '\n\n').trim();
}

/** Accept a string or string[] and return trimmed, non-empty messages. */
export function normalizeMessages(input) {
  const list = Array.isArray(input) ? input : [input];
  return list.map((item) => String(item ?? '').trim()).filter(Boolean);
}

/**
 * Split text into chunks of at most maxChars, preferring paragraphs, then
 * lines, then spaces. Never returns empty chunks.
 */
export function splitText(text, maxChars = 1500) {
  const limit = Math.max(200, Number(maxChars) || 1500);
  let rest = String(text ?? '').replace(/\r\n/gu, '\n').trim();
  const out = [];
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n\n', limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf(' ', limit);
    if (cut < limit * 0.5) cut = limit;
    const chunk = rest.slice(0, cut).trim();
    if (chunk) out.push(chunk);
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

/** Strip common provider/stack noise before showing an error in chat. */
export function publicError(error) {
  const raw = String(error?.message ?? error ?? '').replace(/\s+/gu, ' ').trim();
  if (!raw) return '内部错误';
  return raw.length > 160 ? `${raw.slice(0, 160)}…` : raw;
}
