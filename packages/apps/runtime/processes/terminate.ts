// 종료 분류. 정지 요청 전에 의도된 종료로 표시한 종료만 crash가 아니다.
// 동시 신호가 와도 표시가 먼저면 crash로 세지 않는다.

export type StopReason =
  | "daemon_shutdown"
  | "restart"
  | "release_change"
  | "user_stop"
  | "core_eof";

export type Termination = {
  intended: StopReason | undefined;
  exitCode: number | null;
};

// 의도된 종료가 아니면서 0이 아닌 종료(신호 종료 포함)만 예상 밖이다.
export function unexpected(termination: Termination): boolean {
  if (termination.intended !== undefined) return false;
  return termination.exitCode !== 0;
}
