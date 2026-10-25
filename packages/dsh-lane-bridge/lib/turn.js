// Collect assistant text for one DSH turn.
//
// Kept tiny and dependency-free so both the plugin and its tests can use it.
// `assistant/chunk` is ignored on purpose: `assistant/message` carries the same
// text once, assembled; counting both duplicates every reply.
export function createTurnCollector() {
  const turns = new Map();
  return {
    push(event) {
      if (!event || typeof event.type !== 'string') return null;
      if (event.type === 'turn/start') {
        turns.set(event.data?.turn, { text: '', error: null });
        return null;
      }
      if (event.type === 'assistant/chunk') return null;
      if (event.type === 'assistant/message') {
        const turn = turns.get(event.data?.turn);
        if (!turn) return null;
        for (const block of event.data?.message?.content ?? []) {
          if (block?.type === 'text' && typeof block.text === 'string') turn.text += block.text;
        }
        return null;
      }
      if (event.type === 'turn/end') {
        const turn = turns.get(event.data?.turn);
        turns.delete(event.data?.turn);
        if (!turn) return null;
        return {
          turn: event.data?.turn,
          reason: event.data?.reason ?? { kind: 'unknown' },
          text: turn.text,
        };
      }
      return null;
    },
    has(turn) {
      return turns.has(turn);
    },
    size() {
      return turns.size;
    },
  };
}

export function isTurnError(ended) {
  return ended?.reason?.kind === 'error' || ended?.reason?.kind === 'failed';
}
