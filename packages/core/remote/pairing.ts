import type { Clock, RandomSource } from "../../base/mod.ts";
import { remoteKeyText } from "../../protocol/remote/mod.ts";

export const PAIRING_CODE_MS = 300_000;

// 1회용 pairing code. 메모리에만 있고 하나뿐이다: 새 code가 옛 code를 무효로 한다.
export type PairingCodes = {
  start(): { code: string; expiresAt: number };
  // 맞으면 code를 쓰고 true다. 틀리거나 지났거나 이미 썼으면 false다.
  take(code: string): boolean;
};

export function createPairingCodes(deps: {
  clock: Clock;
  random: RandomSource;
}): PairingCodes {
  let current: { code: string; expiresAt: number } | undefined;
  return {
    start() {
      const bytes = new Uint8Array(16);
      deps.random.fill(bytes);
      current = {
        code: remoteKeyText(bytes),
        expiresAt: deps.clock.nowMs() + PAIRING_CODE_MS,
      };
      return { ...current };
    },
    take(code) {
      if (current === undefined) return false;
      if (deps.clock.nowMs() >= current.expiresAt) {
        current = undefined;
        return false;
      }
      if (!sameText(code, current.code)) return false;
      current = undefined;
      return true;
    },
  };
}

// 글자마다 같은 시간이 걸리게 견준다. 길이는 숨기지 않는다(code 길이는 공개 값이다).
function sameText(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) {
    difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return difference === 0;
}
