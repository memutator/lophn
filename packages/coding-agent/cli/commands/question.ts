// question command의 route 표와 `question open` 실행이다(T16, cli#R7·R21). list·show는
// 소유 읽기 route로 core에 닿는다. open은 결정 화면 링크와 대기 사실만 낸다: confirmation
// window를 열지 않고 TTY의 yes나 옵션으로 답하지 않는다. 답·미루기·취소·적용 command는
// 표에 없다(질문의 결정은 사람 화면이다).
import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
import {
  cliQuestionListSchema,
  cliQuestionOpenSchema,
  cliQuestionShowSchema,
} from "../../../protocol/coding-agent/mod.ts";
import {
  questionList,
  questionRead,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  type FlowClient,
  type QuestionRecord,
  questionStateText,
  questionView,
} from "../../connection/mod.ts";
import type { CommandEntry } from "./types.ts";

export const QUESTION_COMMANDS: readonly CommandEntry[] = [
  {
    name: "question list",
    input: cliQuestionListSchema,
    monoRoute: questionList,
  },
  {
    name: "question show",
    input: cliQuestionShowSchema,
    monoRoute: questionRead,
  },
  // open은 결정 화면 링크와 대기 사실만 낸다. 답을 입력받지 않는다(cli#R21).
  {
    name: "question open",
    input: cliQuestionOpenSchema,
  },
];

export type QuestionOpenDeps = { client: Pick<FlowClient, "read"> };

export type QuestionOpenReport = {
  summary: string;
  data: {
    group: string;
    state: string;
    waiting: boolean;
    decision_link: string | null;
    // open은 창을 열지 않고 답을 받지 않는다. 항상 false다.
    window_opened: false;
  };
  next: string[];
};

// 질문을 한 번 읽어 대기 사실과 결정 화면 링크를 낸다. 대기가 아니면 열 결정이 없다.
// 읽기 실패(범위 밖·없는 질문)는 core 오류 그대로다. 질문은 이 호출로 바뀌지 않는다.
export async function runQuestionOpen(
  input: { group: string },
  deps: QuestionOpenDeps,
): Promise<Result<QuestionOpenReport, LophnError>> {
  const read = await deps.client.read(questionRead, { group: input.group });
  if (!read.ok) return err(read.error);
  const record = (read.value as { group: QuestionRecord }).group;
  const shown = questionView(record);
  return ok({
    summary: `질문 묶음 ${shown.id}: ${questionStateText(shown.state)}`,
    data: {
      group: shown.id,
      state: shown.state,
      waiting: shown.waiting,
      decision_link: shown.decision_link,
      window_opened: false,
    },
    next: shown.waiting
      ? [
        `사람이 ${shown.decision_link}에서 답한다. 창을 닫거나 기한이 지나면 질문은 그대로다`,
      ]
      : [`question show ${shown.id}로 닫힌 결과를 읽는다`],
  });
}
