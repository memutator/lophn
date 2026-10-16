import { ok, type Result } from "../../../../base/mod.ts";
import type { Tx } from "../../../../protocol/server/mod.ts";
import { isFinishedSummaryCall } from "../mod.ts";
import type { RewindEffects } from "./mod.ts";

// rewind가 대화 밖에 미치는 효과의 조립이다. 대기 중인 권한 요청과 질문은 session snapshot이 가지고 있어
// 그 session의 것을 `cancelPendingRequests`가 취소한다(session을 끝낼 때와 같은 효과). 보류 request는
// session에 묶이지 않으므로 여기서 건드리지 않는다.
export function createRewindEffects(deps: {
  cancelPendingRequests(tx: Tx, session: string): Result<void>;
}): RewindEffects {
  return {
    // "Summarize from here"의 근거는 Compact와 같은 요약 call이다. 같은 call로 두 번 접지 않는다.
    summaryOk(lookup, input) {
      if (!isFinishedSummaryCall(lookup, input.session, input.call)) {
        return false;
      }
      return lookup.sql.get(
        "select 1 as found from reverts where summary_call = ? and outcome != 'blocked'",
        [input.call],
      ) === undefined;
    },

    // 숨기는 구간에서 기다리던 권한 요청과 질문을 취소한다. 취소하지 못하면 오류를 돌려 rewind 전체가
    // 되돌려진다.
    cancelWaiting(tx, input) {
      const cancelled = deps.cancelPendingRequests(tx, input.session);
      return cancelled.ok ? ok(undefined) : cancelled;
    },
  };
}
