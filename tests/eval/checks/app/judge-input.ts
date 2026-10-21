// judge가 받는 입력을 만든다. fixture(core === null)에서도 빈 글이 아닌 글을 돌려준다.
import type { AskInput } from "../../../../packages/protocol/lophn-agent/ask-tool.ts";
import { asksGapInput } from "../../judge/mod.ts";
import type { CheckInput } from "../../types.ts";
import { toolCallsOf } from "../records.ts";

// request는 사람 말(`say`)이다.
export function askedAgainInput(
  request: string,
): (input: CheckInput) => string {
  return ({ trial }) => {
    const questions = toolCallsOf(trial, "ask").flatMap((c) =>
      (c.input as { questions?: AskInput["questions"] } | null)?.questions ??
        []
    );
    return asksGapInput(request, questions);
  };
}
