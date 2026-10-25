// Turn-end delivery policy.
//
// Kept separate from the plugin entry so the "did the agent already send?" and
// error paths are unit-testable without a DSH host.
import { splitText, stripMarkdown } from './text.js';

export const DEFAULT_APOLOGY = '抱歉，我这边处理这条消息时出错了，请稍后再试。';

export function createReplyDispatcher({ store, channels, consumeSent, logger = null, apology = DEFAULT_APOLOGY }) {
  return async function onTurnEnd({ key, ended, resolved }) {
    const sentByAgent = consumeSent?.(key) ?? 0;
    if (ended?.reason?.kind === 'error' || ended?.reason?.kind === 'failed') {
      if (!sentByAgent) {
        logger?.warn?.(`[lane-bridge] ${key} 回合失败：${ended?.reason?.error?.message ?? ended?.reason?.kind}`);
        try { await channels.sendKey(key, [apology]); } catch (error) {
          logger?.warn?.(`[lane-bridge] 错误提示发送失败：${error?.message ?? error}`);
        }
      }
      return;
    }
    if (sentByAgent) return;
    let text = String(ended?.text ?? '').trim();
    if (!text) return;
    const config = store.get().config;
    if (config.reply?.stripMarkdown !== false) text = stripMarkdown(text);
    const maxChars = Math.max(200, Number(resolved?.maxReplyChars) || Number(config.reply?.maxChars) || 1500);
    const chunks = splitText(text, maxChars);
    if (chunks.length === 0) return;
    try {
      await channels.sendKey(key, chunks);
      logger?.debug?.(`[lane-bridge] ${key} 已发送 ${chunks.length} 条`);
    } catch (error) {
      logger?.warn?.(`[lane-bridge] ${key} 回复发送失败：${error?.message ?? error}`);
    }
  };
}
