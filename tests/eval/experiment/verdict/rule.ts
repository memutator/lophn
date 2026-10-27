// 판정 규칙 default@1. 규칙을 바꾸면 이름을 올린다(default@2). spec이 이름으로 가리키므로 옛 result가 어느 규칙으로 계산됐는지 남는다.
//
// entry마다 status를 위에서 처음 맞는 조건으로 정한다. vt/bt = variant/baseline tally, vv/bv = poolVerdict.
//   전부   incomplete    remaining > 0, vt.trials === 0, vt.pending > 0, 또는 (target·guard이고 bt.trials === 0 이고 bt.pending > 0)
//   target ok            vv === pass 이고 variant 통과율 > baseline 통과율
//   target not_improved  vv === pass 인데 통과율이 기준 이하(이미 통과하던 target이라 가설이 틀렸다)
//   target fail          vv !== pass
//   case   ok / fail     vv === pass / 아니다. 기준과 비교하지 않는다(미리 써 둔 새 case는 기준이 없을 수 있다)
//   guard  worse         vv === fail 이고 bv !== fail
//   guard  ok            그 밖. 통과율이 기준보다 낮으면 weaker 표시
// pass = 엄격한 과반(1번이면 1/1, 3번이면 2/3 이상). split(정확히 절반)은 통과가 아니다.
// 전체: fail·not_improved·worse가 하나라도 있으면 reject(끝나지 않은 entry가 있어도), 아니고 incomplete가 있으면 inconclusive, 아니면 adopt.
//
// 한계: 3번 이하 trial로는 우연과 나빠짐을 완전히 가르지 못한다. 기준 통과율이 60% 안팎인 guard는 우연히 worse가 될 수 있다.
// 결론이 의심되면 spec의 trials.max를 올린 새 spec을 쓴다. 규칙은 어림하지 않는다.
// guard를 check 단위가 아니라 trial 전체의 통과로 센다: 한 check만 나빠지고 다른 check가 가린 경우는 보이지 않는다.
import {
  type Outcome,
  poolVerdict,
  type ScenarioResult,
  type Tally,
  tallyOf,
} from "../spec/mod.ts";
import type { VerdictEntry } from "./types.ts";

export type EntryJudgment = {
  vt: Tally;
  bt: Tally;
  status: ScenarioResult["status"];
  weaker: boolean;
};

const rateLess = (a: Tally, b: Tally) =>
  a.passed * b.trials < b.passed * a.trials;

export function judgeEntry(e: VerdictEntry): EntryJudgment {
  const vt = tallyOf(e.variant, e.checks);
  const bt = tallyOf(e.baseline, e.checks);
  const out = (status: ScenarioResult["status"], weaker = false) => ({
    vt,
    bt,
    status,
    weaker,
  });
  const vv = poolVerdict(vt);
  const bv = poolVerdict(bt);

  if (
    e.remaining > 0 ||
    vt.trials === 0 ||
    vt.pending > 0 ||
    (e.role !== "case" && bt.trials === 0 && bt.pending > 0)
  )
    return out("incomplete");

  if (e.role === "target") {
    if (vv !== "pass") return out("fail");
    return out(rateLess(bt, vt) ? "ok" : "not_improved");
  }
  if (e.role === "case") return out(vv === "pass" ? "ok" : "fail");
  if (vv === "fail" && bv !== "fail") return out("worse");
  return out("ok", rateLess(vt, bt));
}

export function decisionOf(
  statuses: ScenarioResult["status"][],
): "adopt" | "reject" | "inconclusive" {
  if (
    statuses.some((s) => s === "fail" || s === "not_improved" || s === "worse")
  ) {
    return "reject";
  }
  return statuses.includes("incomplete") ? "inconclusive" : "adopt";
}

export const costOf = (outcomes: Outcome[]) =>
  outcomes.reduce((sum, o) => sum + o.cost_usd, 0);
