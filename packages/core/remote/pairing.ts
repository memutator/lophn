import type { Clock, RandomSource } from "../../base/mod.ts";
import { remoteKeyText } from "../../protocol/remote/mod.ts";

export const PAIRING_CODE_MS = 300_000;

// 사람이 pairing 화면에서 code와 같이 정한 것. code로 붙은 기기가 처음부터 갖는다.
export type PairingGrant = { terminal_input: boolean };

// 1회용 pairing code. 메모리에만 있고 하나뿐이다: 새 code가 옛 code를 무효로 한다.
export type PairingCodes = {
  start(grant: PairingGrant): { code: string; expiresAt: number };
  // 맞으면 code를 쓰고 그 code와 같이 정한 것을 낸다. 틀리거나 지났거나 이미 썼으면 undefined다.
  take(code: string): PairingGrant | undefined;
};

export function createPairingCodes(deps: {
  clock: Clock;
  random: RandomSource;
}): PairingCodes {
  let current:
    | { code: string; expiresAt: number; grant: PairingGrant }
    | undefined;
  return {
    start(grant) {
      const bytes = new Uint8Array(16);
      deps.random.fill(bytes);
      current = {
        code: remoteKeyText(bytes),
        expiresAt: deps.clock.nowMs() + PAIRING_CODE_MS,
        grant: { ...grant },
      };
      return { code: current.code, expiresAt: current.expiresAt };
    },
    take(code) {
      if (current === undefined) return undefined;
      if (deps.clock.nowMs() >= current.expiresAt) {
        current = undefined;
        return undefined;
      }
      if (!sameText(code, current.code)) return undefined;
      const { grant } = current;
      current = undefined;
      return grant;
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
