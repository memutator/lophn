import type { TurnMode } from "../../../protocol/lophn-agent/mod.ts";

// turn을 시작할 때 mode를 정한다. unattended가 먼저다. skip이 먼저면 skip session이 받은 unattended
// call의 turn이 표시를 떨어뜨려 사슬 아래가 attended가 된다(plan README "뼈대 검토에서 정한 것").
export function turnModeOf(
  session: { skip: boolean },
  input: { unattended: boolean },
): TurnMode {
  if (input.unattended) return "unattended";
  return session.skip ? "skip" : "attended";
}
