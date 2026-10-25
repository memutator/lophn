import type { CodeLine, Highlighter } from "@lophn/ui/reading";
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
    highlight(code, language) {
      const target = start();
      if (target === null) return Promise.resolve(null);
      const id = ++lastId;
      return new Promise((resolve) => {
        waiting.set(id, resolve);
        target.postMessage({ id, code, language } satisfies HighlightRequest);
      });
    },
  };
}
