// supervisor 메모리의 앱 log buffer. invocation마다 최근 200줄, 앱마다 최근 500개
// invocation, invocation에 묶이지 않은 log는 최근 500줄, redaction 뒤 한 줄 300자(R26).
// 추가 조회는 최대 200줄이고 실패 직후 마지막 flush는 최대 20ms만 기다린다(R27).
// 줄 redaction은 조립이 주입한다(최상위 경계는 contracts만 거친다).
import {
  type AppLogState,
  LOG_LINE_MAX_COUNT,
  LOG_LINE_MAX_LENGTH,
} from "../../../protocol/apps/mod.ts";
import {
  type ByteSource,
  createStreamDecoder,
  drain,
} from "./stream-decoder.ts";

export const LOG_INVOCATION_MAX_LINES = 200;
export const LOG_INVOCATIONS_MAX = 500;
export const LOG_UNATTACHED_MAX_LINES = 500;
export const LOG_FLUSH_MAX_MS = 20;

// SDK가 invocation 문맥에서 찍는 표시다. 알 수 없는 id를 만들어 붙이지 않는다.
const INVOCATION_MARK = /^\[inv=(inv_[0-9a-z]{26})\] ?/;

export type LogLineLoss = {
  app: string;
  invocation?: string;
  dropped_lines: number;
  reason: "buffer_limit" | "unsafe_truncation";
};

export type LogBufferDeps = {
  app: string;
  // 알려진 secret registry와 credential pattern을 적용한 줄 redaction.
  redact: (line: string) => string;
  // 버린 줄의 진단. supervisor pipe의 app_log_line_loss 진단으로 나간다(contracts#T6).
  onLoss?: (loss: LogLineLoss) => void;
  now: () => number;
  // 테스트가 시간을 건너뛰게 한다. 운영에서는 실제 대기다.
  wait?: (ms: number) => Promise<void>;
};

export type LogQuery = {
  invocation?: string;
  limit: number;
  max_bytes?: number;
  // 앞선 읽기의 next_cursor다. 그 위치보다 오래된 줄을 이어 읽는다.
  cursor?: string;
};

export type LogRead = {
  state: AppLogState;
  lines: string[];
  collected_at: string | null;
  truncated: boolean;
  // 더 오래된 줄이 남았을 때만 있다. 같은 buffer의 절대 줄 번호라 새 줄이 와도 이어진다.
  next_cursor?: string | null;
};

export type LogBuffer = {
  // 이미 줄로 나뉜 한 줄을 모은다. `[inv=<id>]` 표시가 있으면 그 invocation의 log다.
  addLine(line: string): void;
  // 줄바꿈 없이 상한을 넘겨 버린 줄. 어느 invocation의 줄인지 알 수 없다.
  addUnsafeDrop(): void;
  // stdout·stderr를 비동기로 읽어 모은다. 끝나면 resolve한다.
  attach(source: ByteSource): Promise<void>;
  // 수집을 끈다(settings). 끈 동안 read는 off다.
  setCollecting(on: boolean): void;
  // 지금 모인 줄을 읽는다.
  read(query: LogQuery): LogRead;
  // 실패 직후 조회. 읽는 중인 stream이 끝나기를 최대 20ms만 기다리고, 기다리다
  // 끝나지 않았으면 state timeout으로 지금까지 모은 줄을 돌려준다(R27).
  collect(query: LogQuery): Promise<LogRead>;
};

// pushed는 지금까지 넣은 줄 수다. 남은 줄의 절대 번호는 [pushed - lines.length, pushed)다.
type Ring = { lines: string[]; limit: number; pushed: number };

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function createLogBuffer(deps: LogBufferDeps): LogBuffer {
  const invocations = new Map<string, Ring>();
  // Map은 삽입 순서를 지키므로 첫 key가 가장 오래된 invocation이다.
  const evicted = new Set<string>();
  const unattached: Ring = {
    lines: [],
    limit: LOG_UNATTACHED_MAX_LINES,
    pushed: 0,
  };
  const draining = new Set<Promise<void>>();
  let lastAtMs: number | undefined;
  let collecting = true;

  // 모두 끝났으면 true, 시간이 먼저 지나면 false. 쓰지 않은 timer는 거둔다.
  async function allWithin(
    pending: Promise<void>[],
    ms: number,
  ): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = deps.wait
      ? deps.wait(ms).then(() => false)
      : new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      });
    try {
      return await Promise.race([Promise.all(pending).then(() => true), late]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  function lose(
    count: number,
    reason: LogLineLoss["reason"],
    invocation?: string,
  ): void {
    if (count <= 0) return;
    deps.onLoss?.({
      app: deps.app,
      ...(invocation === undefined ? {} : { invocation }),
      dropped_lines: count,
      reason,
    });
  }

  function push(ring: Ring, line: string, invocation?: string): void {
    ring.lines.push(line);
    ring.pushed += 1;
    if (ring.lines.length > ring.limit) {
      ring.lines.shift();
      lose(1, "buffer_limit", invocation);
    }
  }

  function ringFor(invocation: string): Ring {
    const found = invocations.get(invocation);
    if (found) return found;
    const created: Ring = {
      lines: [],
      limit: LOG_INVOCATION_MAX_LINES,
      pushed: 0,
    };
    invocations.set(invocation, created);
    if (invocations.size > LOG_INVOCATIONS_MAX) {
      const oldest = invocations.keys().next().value as string;
      const gone = invocations.get(oldest)!;
      invocations.delete(oldest);
      evicted.add(oldest);
      // 기억하는 밀려난 id도 무한히 늘리지 않는다.
      if (evicted.size > LOG_INVOCATIONS_MAX) {
        evicted.delete(evicted.values().next().value as string);
      }
      lose(gone.lines.length, "buffer_limit", oldest);
    }
    return created;
  }

  function read(query: LogQuery): LogRead {
    const collected = lastAtMs === undefined
      ? null
      : new Date(lastAtMs).toISOString();
    if (!collecting) {
      return { state: "off", lines: [], collected_at: null, truncated: false };
    }
    const ring = query.invocation === undefined
      ? unattached
      : invocations.get(query.invocation);
    if (!ring) {
      // 밀려난 invocation은 있었지만 지금은 못 준다. 부분 확보로 표시한다.
      return {
        state: "ok",
        lines: [],
        collected_at: collected,
        truncated: query.invocation !== undefined &&
          evicted.has(query.invocation),
      };
    }
    const limit = Math.min(query.limit, LOG_LINE_MAX_COUNT);
    const base = ring.pushed - ring.lines.length;
    // 이어 읽기는 cursor 위치의 앞쪽 줄이다. 밀려난 쪽을 넘는 cursor는 남은 줄 끝으로 맞춘다.
    const end = query.cursor === undefined
      ? ring.pushed
      : Math.min(Number(query.cursor), ring.pushed);
    const first = Math.max(end - limit, base);
    let lines = ring.lines.slice(
      Math.max(first - base, 0),
      Math.max(end - base, 0),
    );
    let truncated = first > base;
    if (query.max_bytes !== undefined) {
      // 가장 최근 줄부터 byte 예산 안에 드는 만큼만 돌려준다.
      let used = 0;
      let keep = 0;
      for (let index = lines.length - 1; index >= 0; index--) {
        used += byteLength(lines[index]);
        if (used > query.max_bytes) break;
        keep += 1;
      }
      if (keep < lines.length) {
        lines = lines.slice(lines.length - keep);
        truncated = true;
      }
    }
    const start = end - lines.length;
    const older = start > base;
    return {
      state: "ok",
      lines,
      collected_at: collected,
      truncated: truncated || older,
      ...(older ? { next_cursor: String(start) } : {}),
    };
  }

  return {
    addLine(raw) {
      lastAtMs = deps.now();
      if (!collecting) return;
      const mark = INVOCATION_MARK.exec(raw);
      const invocation = mark?.[1];
      const body = mark ? raw.slice(mark[0].length) : raw;
      // redaction을 먼저 하고 그 뒤에 자른다. 자른 줄에 secret 일부가 남지 않는다.
      const safe = deps.redact(body).slice(0, LOG_LINE_MAX_LENGTH);
      if (invocation === undefined) push(unattached, safe);
      else push(ringFor(invocation), safe, invocation);
    },
    addUnsafeDrop() {
      lastAtMs = deps.now();
      lose(1, "unsafe_truncation");
    },
    attach(source) {
      const decoder = createStreamDecoder({
        onLine: (line) => this.addLine(line),
        onDropped: () => this.addUnsafeDrop(),
      });
      const done = drain(source, decoder).finally(() => draining.delete(done));
      draining.add(done);
      return done;
    },
    setCollecting(on) {
      collecting = on;
    },
    read,
    async collect(query) {
      const pending = [...draining];
      const settled = pending.length === 0 ||
        await allWithin(pending, LOG_FLUSH_MAX_MS);
      const result = read(query);
      return settled || result.state !== "ok"
        ? result
        : { ...result, state: "timeout", truncated: true };
    },
  };
}
