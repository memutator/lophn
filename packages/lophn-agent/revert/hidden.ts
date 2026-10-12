import type { Result } from "../../base/mod.ts";
import type { Sql } from "../../contracts/platform/mod.ts";

// 숨김 구간과 접힘 구간(lophn-agent/revert "Revert 불변 조건", conversation#R25). Message는 바꾸지 않고
// reverts 행에서 읽는다. 구현은 agent-RW3d가 채운다.

type Lookup = { sql: Pick<Sql, "get" | "all"> };

// 숨김 구간은 choice가 restore_all·messages_only이고 outcome이 applied·partial·uncertain인 rewind의
// boundary_seq 이후 메시지다. redo=done이면 다시 보여 숨김이 아니다. 여러 rewind가 겹치면 가장 앞선
// boundary_seq가 시작이다. 숨긴 구간이 없으면 null이다. blocked·summarize·undo는 숨기지 않는다.
export function hiddenFromSeq(lookup: Lookup, session: string): string | null {
  void lookup;
  void session;
  throw new Error("not implemented: agent-RW3d");
}

export type FoldedRange = {
  revert: string;
  from_seq: string;
  // 접은 마지막 메시지의 seq. 요약을 접수한 시점의 결과 seq(result_seq)까지다.
  through_seq: string;
  summary_call: string;
};

// choice=summarize이고 applied인 rewind의 접힘 구간이다. 오래된 순서다.
export function foldedRanges(lookup: Lookup, session: string): FoldedRange[] {
  void lookup;
  void session;
  throw new Error("not implemented: agent-RW3d");
}

// 이미 숨긴 구간 안의 메시지는 checkpoint로 고를 수 없다. 숨김 시작 seq 이후(그 seq 포함)의 메시지면
// invalid_input이다.
export function assertCheckpointVisible(
  lookup: Lookup,
  session: string,
  message: string,
): Result<void> {
  void lookup;
  void session;
  void message;
  throw new Error("not implemented: agent-RW3d");
}
