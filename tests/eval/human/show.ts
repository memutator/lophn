import { earlierText, questionsText } from "./answers.ts";
import type { HumanDefinition } from "./definition.ts";
import type { PendingQuestion } from "./pending.ts";

// subagent에게 그대로 줄 글 전문이다. 시나리오 이름, session, 앱, ticket, 진행 상황을 넣지 않는다: 사람이 아는 것만 준다.
export function renderForAgent(
  def: HumanDefinition,
  q: PendingQuestion,
): string {
  return `${def.prompt}\n<requirement_card>\n${q.card}\n</requirement_card>\n<earlier_answers>\n${earlierText(
    q.earlier,
  )}\n</earlier_answers>\n<questions>\n${questionsText(
    q.questions,
  )}\n</questions>`;
}
