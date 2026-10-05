// supervisor log buffer. invocation당 최근 200줄, 앱당 최근 500 invocation,
// 미연결 log 최근 500줄, redaction 뒤 한 줄 300자, secret 없음(R26).
// 추가 조회는 최대 200줄이고 실패 직후 flush 대기는 최대 20ms다(R27).
// line redactor는 조립이 주입한다(최상위 경계는 contracts만 거친다).
import { LOG_LINE_MAX_LENGTH } from "../../../contracts/apps/mod.ts";
import type { LineRedactor } from "./stream-decoder.ts";

export const LOG_INVOCATION_MAX = 200;
export const LOG_INVOCATIONS_MAX = 500;
export const LOG_UNATTACHED_MAX = 500;

export type LogLineLoss = {
  app: string;
  invocation?: string;
  dropped_lines: number;
  reason: "buffer_limit" | "unsafe_truncation";
};

export type LogBufferDeps = {
  app: string;
  // 알려진 secret registry와 credential pattern이 묶인 줄 redactor.
  redactor: LineRedactor;
  // 버린 줄의 진단. supervisor pipe의 diagnostic 메시지로 나간다(contracts#T6).
  onLoss?: (loss: LogLineLoss) => void;
  now: () => number;
};

export type LogBuffer = {
  // invocation log을 모은다. chunk는 이어 붙이고 줄바꿈 단위로 확정한다.
  pushInvocation(invocation: string, data: string): void;
  // invocation에 묶이지 않은 log. 앱당 최근 500줄이다(R26).
  pushUnattached(data: string): void;
  // 실패 직후 마지막 flush. 최대 waitMs만 기다린다(R27).
  flush(waitMs?: number): Promise<void>;
  // 추가 log 조회. 최대 200줄, truncated로 부분 수집을 표시한다(R27).
  read(input: {
    invocation?: string;
    limit: number;
  }): {
    state: "ok" | "timeout";
    lines: string[];
    collected_at: string | null;
    truncated: boolean;
  };
};

type Ring<T> = {
  items: T[];
  limit: number;
};

function createRing<T>(limit: number): Ring<T> {
  return { items: [], limit };
}

// 가장 오래된 항목부터 밀어낸다. 밀려난 줄은 loss로 남긴다(R26).
function append(
  ring: Ring<string>,
  next: readonly string[],
  onDropped: (count: number) => void,
): void {
  ring.items.push(...next);
  if (ring.items.length > ring.limit) {
    const removed = ring.items.splice(0, ring.items.length - ring.limit);
    onDropped(removed.length);
  }
}

// redaction 뒤에 자른다. secret은 이미 지워졌으므로 300자가 안전하다(R26).
function capped(lines: readonly string[]): string[] {
  return lines.map((line) =>
    line.length <= LOG_LINE_MAX_LENGTH
      ? line
      : line.slice(0, LOG_LINE_MAX_LENGTH)
  );
}

type InvocationLog = {
  lines: Ring<string>;
  // 줄바꿈으로 끝나지 않은 꼬리. 다음 chunk와 이어 붙인다.
  tail: string;
};

export function createLogBuffer(deps: LogBufferDeps): LogBuffer {
  const invocations = new Map<string, InvocationLog>();
  // 최근 500 invocation만 유지한다. 밀려난 invocation은 loss로 남긴다(R26).
  const order: string[] = [];
  const unattached: InvocationLog = {
    lines: createRing(LOG_UNATTACHED_MAX),
    tail: "",
  };
  let lastAtMs: number | undefined;

  function loss(count: number, invocation: string | undefined): void {
    if (count <= 0) return;
    deps.onLoss?.({
      app: deps.app,
      ...(invocation === undefined ? {} : { invocation }),
      dropped_lines: count,
      reason: "buffer_limit",
    });
  }

  function push(target: InvocationLog, invocation: string | undefined): void {
    if (target.tail === "") return;
    lastAtMs = deps.now();
    // 줄바꿈이 없으면 아직 진행 중이므로 꼬리로 둔다. 상한은 확정 때만 본다.
    const lastNewline = target.tail.lastIndexOf("\n");
    if (lastNewline < 0) return;
    const text = target.tail.slice(0, lastNewline + 1);
    target.tail = target.tail.slice(lastNewline + 1);
    // 완성한 줄마다 stream을 끝낸다. 보류 꼬리가 다음 줄로 새지 않고
    // 저장하는 줄은 줄바꿈을 뗀 값이다(R26).
    const redacted = text.split("\n").filter((line) => line !== "").map(
      (line) =>
        capped([deps.redactor.push(`${line}\n`) + deps.redactor.finish()])
          [0].replace(/\n$/, ""),
    );
    append(target.lines, redacted, (count) => loss(count, invocation));
  }

  return {
    pushInvocation(invocation, data) {
      let entry = invocations.get(invocation);
      if (!entry) {
        entry = { lines: createRing(LOG_INVOCATION_MAX), tail: "" };
        invocations.set(invocation, entry);
        order.push(invocation);
        if (order.length > LOG_INVOCATIONS_MAX) {
          const evicted = order.splice(0, order.length - LOG_INVOCATIONS_MAX);
          for (const old of evicted) {
            const oldEntry = invocations.get(old);
            if (!oldEntry) continue;
            // 밀려난 invocation의 미확정 꼬리와 줄은 loss다(R26).
            loss(
              oldEntry.lines.items.length + (oldEntry.tail === "" ? 0 : 1),
              old,
            );
            invocations.delete(old);
          }
        }
      }
      entry.tail += data;
      lastAtMs = deps.now();
      push(entry, invocation);
    },
    pushUnattached(data) {
      unattached.tail += data;
      lastAtMs = deps.now();
      push(unattached, undefined);
    },
    // flush 대기는 최대 20ms다(R27). 줄은 이미 도착한 것만 남는다.
    async flush(waitMs = 20) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    },
    read(input) {
      const collected = lastAtMs === undefined
        ? null
        : new Date(lastAtMs).toISOString();
      if (input.invocation === undefined) {
        return feed(unattached, input.limit, collected);
      }
      const found = invocations.get(input.invocation);
      if (!found) {
        // 500 invocation 한도에 밀렸다. 예산 초과다(timeout, R26).
        return {
          state: "timeout",
          lines: [],
          collected_at: collected,
          truncated: false,
        };
      }
      return feed(found, input.limit, collected);
    },
  };
}

// 조회는 최대 200줄이다(R27). older lines는 buffer에 남는다.
function feed(
  target: InvocationLog,
  limit: number,
  collected: string | null,
): {
  state: "ok" | "timeout";
  lines: string[];
  collected_at: string | null;
  truncated: boolean;
} {
  const lines = target.lines.items.slice(-limit);
  return {
    state: "ok",
    lines,
    collected_at: collected,
    truncated: target.lines.items.length > lines.length,
  };
}
