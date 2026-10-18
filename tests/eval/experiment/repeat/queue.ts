import type { Clock } from "../../../../packages/base/mod.ts";
import {
  type JudgeDefinition,
  judgeKey,
  newJudgeItem,
  writePending,
} from "../../judge/mod.ts";
import type { Criterion, TrialRecord } from "../../types.ts";
import type { RepeatFinding } from "../spec/mod.ts";
import { findRepeatGroups } from "./find.ts";
import { repeatKindInput } from "./input.ts";

// 채점은 돌리는 agent가 `eval:judge`로 넣는다. 여기서는 API를 부르지 않고 대기 entry만 쓴다.
export async function queueRepeats(
  deps: {
    evalDir: string;
    run: string;
    clock: Clock;
    criterion: Criterion;
    judge: JudgeDefinition;
  },
  trial: TrialRecord,
  opts: { maxGroups?: number } = {},
): Promise<RepeatFinding[]> {
  const groups = findRepeatGroups(trial).slice(0, opts.maxGroups ?? 3);
  const findings: RepeatFinding[] = [];
  for (const [i, group] of groups.entries()) {
    const check = `repeat:${group.tool}#${i}`;
    const item = newJudgeItem({
      check,
      criterion: deps.criterion,
      input: repeatKindInput(group),
      judge: deps.judge,
    });
    const key = judgeKey(trial.index, check);
    await writePending(deps.evalDir, {
      key,
      run: deps.run,
      trial: trial.index,
      kind: "diagnosis",
      asked_at: deps.clock.now(),
      criterion: deps.criterion,
      item,
    });
    findings.push({
      trial: trial.index,
      session: group.session,
      tool: group.tool,
      count: group.calls.length,
      calls: group.calls,
      key,
      item,
    });
  }
  return findings;
}
