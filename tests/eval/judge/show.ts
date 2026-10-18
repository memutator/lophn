import type { JudgeDefinition } from "./definition.ts";
import type { PendingJudge } from "./pending.ts";

// subagent에게 그대로 줄 글 전문이다. 시나리오 이름, 다른 item, 진행 상황을 넣지 않는다: 채점이 돌리는 쪽의 가설에 끌리지 않게 한다.
export function renderForAgent(
  def: JudgeDefinition,
  entry: PendingJudge,
): string {
  const { criterion, item } = entry;
  return `${def.prompt}\n<question>${criterion.question}</question>\n<allowed_verdicts>${
    criterion.verdicts.join(", ")
  }</allowed_verdicts>\n<input>\n${item.input}\n</input>`;
}
