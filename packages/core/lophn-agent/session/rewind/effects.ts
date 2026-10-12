import { ok } from "../../../../base/mod.ts";
import { cancelApprovalRequest } from "../../../../protocol/server/mod.ts";
import { isFinishedSummaryCall } from "../mod.ts";
import { cancelGroupsFrom } from "../../tools/questions/mod.ts";
import type { RewindEffects } from "./mod.ts";

// rewind가 대화 밖에 미치는 효과의 조립이다(lophn-agent/revert "대화 밖 상태", R15). 질문(lophn-agent)과
// approval(platform)을 한 transaction에서 만지므로 두 concern을 잇는 core가 맡는다.
export function createRewindEffects(): RewindEffects {
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

    // 숨기는 구간에서 기다리던 질문 묶음과 approval request를 취소한다. 하나라도 취소하지 못하면 오류를 돌려
    // rewind 전체가 되돌려진다.
    cancelWaiting(tx, input) {
      const questions = cancelGroupsFrom(tx, input.session, input.from_seq);
      if (!questions.ok) return questions;
      const waiting = tx.sql.all(
        `select a.id as id, a.created_seq as created_seq
           from approval_requests a join runs r on r.id = a.run
          where r.session = ? and a.status = 'pending' and a.created_seq >= ?
          order by a.created_seq`,
        [input.session, Number(input.from_seq)],
      );
      for (const request of waiting) {
        const created_seq = String(request["created_seq"]);
        const cancelled = tx.call(cancelApprovalRequest, {
          approval: String(request["id"]),
          created_seq,
          closed_reason: null,
        }, { created_seq });
        if (!cancelled.ok) return cancelled;
      }
      return ok({ questions: questions.value, approvals: waiting.length });
    },

    // 문서를 읽은 기록(읽은 판)은 run마다 메모리에 있다. rewind는 끝나지 않은 run이 없을 때만 적용되고 이후
    // run은 새 기록으로 시작하므로 숨김 시작 앞 기준으로 다시 잡을 상태가 따로 남지 않는다.
    resetReadState() {
      return ok(undefined);
    },
  };
}
