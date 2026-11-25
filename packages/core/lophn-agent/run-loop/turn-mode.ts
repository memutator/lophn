import type { TurnMode } from "../../../protocol/lophn-agent/mod.ts";

// turn을 시작할 때 실행 맥락 mode를 정한다(attended | unattended).
// 권한 단계(permission_mode)는 session이 따로 관리하므로 여기서 보지 않는다.
export function turnModeOf(input: { unattended: boolean }): TurnMode {
  return input.unattended ? "unattended" : "attended";
}
