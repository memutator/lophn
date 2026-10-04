import type { GroupKey } from "../../contracts/problems/mod.ts";
import type { LophnError, Result } from "../../base/mod.ts";
import { canonicalize, err, ok } from "../../base/mod.ts";
import { groupKeySchema } from "../../contracts/problems/mod.ts";
import {
  problemObserved,
  problemOpened,
} from "../../contracts/problems/mod.ts";
import type { Tx } from "../../contracts/platform/mod.ts";
import { findProblem, type ProblemRow } from "../reporting/mod.ts";

const INVALID_KEY = "grouping 값이 올바르지 않다";

export type ProblemState = "open" | "fixing" | "closed";

// key는 (app, kind, code, discriminator)의 canonical JSON이다. release·업무 값·
// message·시각을 넣지 않는다(domain-model problems/grouping).
export function groupKeyText(key: GroupKey): string {
  return canonicalize(key);
}

// grouping 값 형식을 본다.
export function parseGroupKey(value: unknown): Result<GroupKey, LophnError> {
  const parsed = groupKeySchema.safeParse(value);
  if (!parsed.success) {
    return err({ code: "invalid_input", message: INVALID_KEY });
  }
  return ok(parsed.data);
}

// (app, group_key) unique는 상태와 무관하게 같은 문제를 찾는다(grouping#R10).
// 닫힌 문제도 같은 key로 찾고 기간 상한이 없다.
export function existingProblem(
  sql: Pick<Tx["sql"], "get">,
  app: string,
  key: string,
): ProblemRow | null {
  return findProblem(sql, app, key);
}

// 없음→open은 첫 유효 운영 Report 하나로 열고 ProblemOpened를 낸다(reporting#R3,
// grouping#R1). open/fixing→동일, closed→closed 유지는 ProblemObserved다.
// 2번째 발생을 기다리는 상태가 없다. closed+현재 활성 release의 reopen은 T21.
export function emitOpened(
  tx: Tx,
  problemId: string,
  app: string,
  groupKey: GroupKey,
  report: string,
): void {
  tx.emit(problemOpened, problemId, {
    app,
    group_key: groupKey,
    report,
  });
}

export function emitObserved(
  tx: Tx,
  problemId: string,
  report: string,
  release: string | null,
  activeRelease: string | null,
  previousStatus: ProblemState,
): void {
  tx.emit(problemObserved, problemId, {
    report,
    release,
    active_release_at_acceptance: activeRelease,
    previous_status: previousStatus,
  });
}
