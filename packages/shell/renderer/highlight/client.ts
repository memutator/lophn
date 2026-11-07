import type { CodeLine, Highlighter } from "@lophn/ui/reading";
import { MAX_HIGHLIGHT_CHARS } from "./incremental.ts";
import { Lru } from "./lru.ts";
import type { HighlightReply, HighlightRequest } from "./messages.ts";

// Worker는 문서 주소(lophn-shell://desktop/index.html) 기준 ./highlight-worker.js다.
export function createWorkerHighlighter(): Highlighter {
  let worker: Worker | null = null;
  let dead = false;
  let lastId = 0;
  const waiting = new Map<
    number,
    (lines: readonly CodeLine[] | null) => void
  >();

  // 다 쓴 block의 결과. 탭 전환이나 가상화로 다시 mount해도 다시 칠하지 않는다. theme은 하나뿐이라 key에 없다.
  const settled = new Lru<string, readonly CodeLine[]>(64);
  const anonymous = () => `anon-${++lastId}`;

  const fail = () => {
    dead = true;
    for (const resolve of waiting.values()) resolve(null);
    waiting.clear();
  };

  const start = (): Worker | null => {
    if (dead) return null;
    if (worker !== null) return worker;
    try {
      const started = new Worker("./highlight-worker.js", { type: "module" });
      started.addEventListener(
        "message",
        (event: MessageEvent<HighlightReply>) => {
          const resolve = waiting.get(event.data.id);
          if (resolve === undefined) return;
          waiting.delete(event.data.id);
          resolve(event.data.lines);
        },
      );
      started.addEventListener("error", fail);
      worker = started;
      return started;
    } catch {
      fail();
      return null;
    }
  };

  return {
    highlight(code, language, options) {
      if (code.length > MAX_HIGHLIGHT_CHARS) return Promise.resolve(null);
      const partial = options?.partial === true;
      const cacheKey = `${language}\0${code}`;
      if (!partial) {
        const hit = settled.get(cacheKey);
        if (hit !== undefined) return Promise.resolve(hit);
      }
      const target = start();
      if (target === null) return Promise.resolve(null);
      const id = ++lastId;
      return new Promise<readonly CodeLine[] | null>((resolve) => {
        waiting.set(id, (lines) => {
          if (!partial && lines !== null) settled.set(cacheKey, lines);
          resolve(lines);
        });
        target.postMessage({
          id,
          code,
          language,
          key: options?.key ?? anonymous(),
          final: !partial,
        } satisfies HighlightRequest);
      });
    },
  };
}
