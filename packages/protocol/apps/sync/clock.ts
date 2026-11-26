import type { SyncDb } from "./db.ts";
import { getState, setState } from "./tables.ts";

// HLC 하나는 SQLite INTEGER 하나(양수 63 bit)다: [ms 42 bit][counter 5 bit][node 16 bit].
// - ms 42 bit는 2109년까지 간다. 같은 ms 안의 33번째 clock은 ms를 하나 당겨 쓴다(logical이라 괜찮다).
// - 같은 replica에서는 (ms, counter)가 늘 커져서 node 몫과 상관없이 커진다.
// - 두 replica가 같은 (ms, counter)를 내도 node 몫이 달라 정수가 다르고, 모든 replica가 같은 쪽을 고른다.
//   node 몫은 node 문자열의 hash라 두 replica의 몫이 같을 확률은 1/65536이고, 그때도 같은 (ms, counter)에
//   같은 칸을 써야 값이 겹친다. 겹치면 "엄격히 크다" 규칙으로 replica마다 먼저 온 쪽이 남는다(받아들인 위험).
// JS number로는 63 bit가 안전하지 않아 늘 bigint로 다룬다. bigint literal(`1n`)은 쓰지 않는다(낮은 target으로 묶는 bundler가 거절한다).
const NODE_BITS = BigInt(16);
const NODE_MASK = BigInt(0xffff);
const COUNTER_BITS = BigInt(5);
const LOW_BITS = NODE_BITS + COUNTER_BITS;
const COUNTER_MAX = 31;
const MS_LIMIT = 2 ** 42;

export type Clock = {
  // 이 replica의 다음 clock. state 표에 남긴다(부르는 쪽 transaction 안에서).
  next(nowMs: number): bigint;
  // 받은 clock. 다음 clock이 그보다 크도록 state를 올린다.
  observe(hlc: bigint): void;
};

// FNV-1a 32 bit의 아래 16 bit. Node와 Hermes에서 같은 값이 나온다.
function nodePart(node: string): bigint {
  let hash = 0x811c9dc5;
  for (let i = 0; i < node.length; i++) {
    hash ^= node.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return BigInt(hash & 0xffff);
}

function hlcParts(hlc: bigint): { ms: number; counter: number } {
  return {
    ms: Number(hlc >> LOW_BITS),
    counter: Number((hlc >> NODE_BITS) & BigInt(COUNTER_MAX)),
  };
}

/**
 * 이 replica가 내거나 본 가장 큰 clock(state의 마지막 clock). 없으면 0.
 */
export function maxHlc(db: SyncDb): bigint {
  return BigInt(getState(db, "hlc") ?? "0");
}

// 그 ms의 가장 작은 clock. 시각으로 정한 경계(흔적 정리의 `beforeHlc`)를 clock과 견줄 때 쓴다.
export function hlcAtMs(ms: number): bigint {
  return BigInt(Math.floor(ms)) << LOW_BITS;
}

export function msOfHlc(hlc: bigint): number {
  return hlcParts(hlc).ms;
}

/** HLC의 하위 16 bit node 몫. 두 쓰기가 다른 기기에서 왔는지 구분할 때 쓴다. */
export function nodeOfHlc(hlc: bigint): number {
  return Number(hlc & NODE_MASK);
}

/**
 * clock이 받는 쪽 시각보다 boundMs 넘게 앞섰으면 앞선 ms, 아니면 0. 앞선 clock은 값을 깎지 않고 부르는 쪽이
 * 미룬다: 깎으면 사본마다 다른 clock을 적어 갈라진다.
 */
export function clockAhead(
  hlc: bigint,
  nowMs: number,
  boundMs: number,
): number {
  const ahead = msOfHlc(hlc) - nowMs;
  return ahead > boundMs ? ahead : 0;
}

/**
 * state 표의 node와 마지막 clock 위에서 도는 HLC. 값은 늘 state에서 읽어 rollback된 transaction과 어긋나지 않는다.
 */
export function openClock(db: SyncDb): Clock {
  return {
    next(nowMs) {
      const node = getState(db, "node");
      if (node === null) throw new Error("sync node is not set");
      const before = hlcParts(maxHlc(db));
      let ms = Math.floor(nowMs);
      let counter = 0;
      if (ms <= before.ms) {
        ms = before.ms;
        counter = before.counter + 1;
        if (counter > COUNTER_MAX) {
          ms += 1;
          counter = 0;
        }
      }
      if (ms >= MS_LIMIT) throw new Error("clock is out of range");
      const hlc =
        (BigInt(ms) << LOW_BITS) |
        (BigInt(counter) << NODE_BITS) |
        nodePart(node);
      setState(db, "hlc", String(hlc));
      return hlc;
    },
    observe(hlc) {
      if (hlc > maxHlc(db)) setState(db, "hlc", String(hlc));
    },
  };
}
