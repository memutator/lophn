import type { RandomSource } from "../random.ts";

// W3C Trace Context 모양이다. 수집기를 바꿔도 id가 그대로 이어지게 OTel과 같은 길이(16·8 byte)를 쓴다.
export type SpanContext = {
  traceId: string;
  spanId: string;
  sampled: boolean;
};

// 지금 도는 span을 async 경계 너머로 들고 가는 자리다. base는 node:async_hooks를 쓸 수 없어서
// core가 AsyncLocalStorage로 구현해 넘긴다.
export type TraceContextStore = {
  active(): SpanContext | undefined;
  run<T>(context: SpanContext, fn: () => T): T;
};

const ZERO_TRACE = "0".repeat(32);
const ZERO_SPAN = "0".repeat(16);
const TRACEPARENT =
  /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/;

function hexOf(random: RandomSource, bytes: number, zero: string): string {
  const buffer = new Uint8Array(bytes);
  // 전부 0인 id는 W3C에서 무효다. 다시 뽑는다.
  for (;;) {
    random.fill(buffer);
    let out = "";
    for (const byte of buffer) out += byte.toString(16).padStart(2, "0");
    if (out !== zero) return out;
  }
}

export function newTraceId(random: RandomSource): string {
  return hexOf(random, 16, ZERO_TRACE);
}

export function newSpanId(random: RandomSource): string {
  return hexOf(random, 8, ZERO_SPAN);
}

// 모르는 뒤 판(version > 00)은 앞 네 칸만 읽는다. 00 판에 꼬리가 붙었거나 ff 판이면 버린다.
export function parseTraceparent(
  value: string | null | undefined,
): SpanContext | undefined {
  if (value === null || value === undefined) return undefined;
  const found = TRACEPARENT.exec(value.trim());
  if (!found) return undefined;
  const [, version, traceId, spanId, flags, rest] = found;
  if (version === "ff") return undefined;
  if (version === "00" && rest !== undefined) return undefined;
  if (traceId === ZERO_TRACE || spanId === ZERO_SPAN) return undefined;
  return {
    traceId,
    spanId,
    sampled: (Number.parseInt(flags, 16) & 1) === 1,
  };
}

export function formatTraceparent(context: SpanContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.sampled ? "01" : "00"}`;
}

// async 경계를 모르는 store. base의 test와 동기 코드만 쓴다.
export function syncContextStore(): TraceContextStore {
  let current: SpanContext | undefined;
  return {
    active: () => current,
    run(context, fn) {
      const previous = current;
      current = context;
      try {
        return fn();
      } finally {
        current = previous;
      }
    },
  };
}
