// 사람이 그 터미널에 키를 넣는 동안 App Engineer의 input을 붙잡는다. 제품에서 사람이 탭에 focus해 있는 동안 쥐는 규칙과 같다.

export type FocusGate = {
  hold(ref: string): () => void;
  whenFree(ref: string): Promise<void>;
};

export function createFocusGate(): FocusGate {
  const holds = new Map<string, number>();
  const waiting = new Map<string, (() => void)[]>();
  return {
    hold(ref) {
      holds.set(ref, (holds.get(ref) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const left = (holds.get(ref) ?? 1) - 1;
        if (left > 0) return holds.set(ref, left);
        holds.delete(ref);
        for (const resolve of waiting.get(ref) ?? []) resolve();
        waiting.delete(ref);
      };
    },
    whenFree(ref) {
      if (!holds.has(ref)) return Promise.resolve();
      return new Promise((resolve) => {
        waiting.set(ref, [...(waiting.get(ref) ?? []), resolve]);
      });
    },
  };
}
