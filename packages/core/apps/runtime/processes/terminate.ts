// 의도된 종료의 이유. 정지 요청 전에 이 표시가 붙은 종료만 crash가 아니다(exit code와 상관없다).
// 동시 신호가 와도 표시가 먼저면 crash로 세지 않는다.

export type StopReason =
  | "daemon_shutdown"
  | "restart"
  | "release_change"
  | "user_stop"
  | "core_eof";
