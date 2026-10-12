import {
  type ChildMessage,
  type ParentMessage,
  REDACT_UNITS_MAX,
  REDACT_WINDOWS_MAX,
} from "../../../protocol/supervision/mod.ts";
import { REDACTION_REPLACEMENT } from "../../../base/redaction/mod.ts";

// model로 보낼 글의 안전화는 core가 한다(lophn-agent/harness/run-loop). 알려진 secret 값은 core의 보호
// 메모리에만 있고 이 프로세스로 오지 않는다. 글을 조각(window)으로 잘라 감독 pipe로 보내고 core가 돌려준
// 지울 자리만 적용한다. 조각은 서로 겹치게 잘라 조각 경계에 걸친 값(길이 `REDACT_OVERLAP` 이하)도 한 조각
// 안에서 온전히 보인다. 어느 조각이든 core가 끝내지 못하거나 기한 안에 답하지 않으면 그 글은 null이고,
// 호출자는 그 글을 보내지 않는다(fail-closed).

export type Redactor = {
  // 안전화한 글. 끝내지 못했으면 null이다. 같은 tick에 부른 것은 한 요청으로 묶는다.
  redact(text: string): Promise<string | null>;
  // 감독 pipe에서 받은 parent message. 이 link의 응답이면 true다.
  onParent(message: ParentMessage): boolean;
};

export const REDACT_OVERLAP = 4_096;
export const REDACT_TIMEOUT_MS = 15_000;

type Span = { index: number; length: number };
type Entry = {
  window: string;
  done(spans: Span[] | null): void;
};

export function createRedactLink(options: {
  send(message: ChildMessage): Promise<void>;
  timeoutMs?: number;
}): Redactor {
  const timeoutMs = options.timeoutMs ?? REDACT_TIMEOUT_MS;
  const pending = new Map<
    string,
    {
      done(spans: Span[][] | null): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let queue: Entry[] = [];
  let scheduled = false;
  let sequence = 0;

  async function dispatch(batch: Entry[]): Promise<void> {
    const id = `redact-${++sequence}`;
    const answered = new Promise<Span[][] | null>((resolve) => {
      const timer = setTimeout(() => {
        if (pending.delete(id)) resolve(null);
      }, timeoutMs);
      pending.set(id, { done: resolve, timer });
    });
    try {
      await options.send({
        type: "redact_request",
        request_id: id,
        windows: batch.map((entry) => entry.window),
      });
    } catch {
      clearTimeout(pending.get(id)?.timer);
      pending.delete(id);
      for (const entry of batch) entry.done(null);
      return;
    }
    const spans = await answered;
    batch.forEach((entry, index) => entry.done(spans?.[index] ?? null));
  }

  function flush(): void {
    scheduled = false;
    const entries = queue;
    queue = [];
    let batch: Entry[] = [];
    let units = 0;
    for (const entry of entries) {
      if (
        batch.length > 0 &&
        (batch.length >= REDACT_WINDOWS_MAX ||
          units + entry.window.length > REDACT_UNITS_MAX)
      ) {
        void dispatch(batch);
        batch = [];
        units = 0;
      }
      batch.push(entry);
      units += entry.window.length;
    }
    if (batch.length > 0) void dispatch(batch);
  }

  function windowSpans(window: string): Promise<Span[] | null> {
    return new Promise((resolve) => {
      queue.push({ window, done: resolve });
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    });
  }

  return {
    async redact(text) {
      if (text.length === 0) return text;
      const step = REDACT_UNITS_MAX - REDACT_OVERLAP;
      const starts: number[] = [];
      for (
        let start = 0;
        start === 0 || start + REDACT_OVERLAP < text.length;
        start += step
      ) {
        starts.push(start);
      }
      const found = await Promise.all(
        starts.map(async (start) => {
          const spans = await windowSpans(
            text.slice(start, start + REDACT_UNITS_MAX),
          );
          return spans === null ? null : spans.map((span) => ({
            index: start + span.index,
            length: span.length,
          }));
        }),
      );
      const spans: Span[] = [];
      for (const part of found) {
        if (part === null) return null;
        spans.push(...part);
      }
      spans.sort((a, b) => a.index - b.index || b.length - a.length);
      let out = "";
      let at = 0;
      for (const span of spans) {
        const end = span.index + span.length;
        if (end <= at) continue;
        out += text.slice(at, Math.max(at, span.index)) + REDACTION_REPLACEMENT;
        at = end;
      }
      return out + text.slice(at);
    },
    onParent(message) {
      if (message.type !== "redact_response") return false;
      const waiting = pending.get(message.request_id);
      if (waiting === undefined) return true;
      pending.delete(message.request_id);
      clearTimeout(waiting.timer);
      waiting.done(message.ok ? message.spans : null);
      return true;
    },
  };
}
