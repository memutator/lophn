import { DatabaseSync } from "node:sqlite";

// 시험이 assignment를 멈춘 상태로 만들거나 되돌린다. 멈춤은 자리 보관 반응이 낼 뿐이고 전역
// assignment(lophn·Context Engineer)는 자리가 없어 그 길로 멈출 수 없다. 이 시험들이 보는 것은
// 멈춘 assignment를 만난 쪽(run 복구·tool 판정·handoff)의 동작이라 ledger 표를 바로 고친다.
// 실제 command가 아니므로 event는 없고 revision만 command처럼 올린다.
export function setAssignmentState(
  dataRoot: string,
  assignment: string,
  state: "paused" | "enabled",
): void {
  const ledger = new DatabaseSync(`${dataRoot}/lophn.db`);
  try {
    ledger.exec("pragma busy_timeout = 5000");
    const paused = state === "paused";
    ledger.prepare(
      `update assignments set state = ?, revision = revision + 1,
         pause_detail = ?, pause_target = ? where id = ?`,
    ).run(
      state,
      paused ? "The place was archived." : null,
      paused ? "prj_01arz3ndektsv4rrffq69g5fav" : null,
      assignment,
    );
  } finally {
    ledger.close();
  }
}
