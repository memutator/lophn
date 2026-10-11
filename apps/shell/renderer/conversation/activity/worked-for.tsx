import type { ReactElement } from "react";

export interface WorkedForProps {
  /** run이 일한 시간(ms). trace의 times.active_ms다. */
  durationMs: number;
}

// 일이 끝난 뒤 남는 회색 "Worked for 18s" 줄. 1분 이상이면 "1m 15s"로 쓴다.
export function WorkedFor(_props: WorkedForProps): ReactElement {
  throw new Error("not implemented: agent-I27");
}
