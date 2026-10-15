// feedback의 순수 규칙. IO가 없다: redaction·blob 준비·읽기는 work.ts가 주입받는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  feedbackTextSchema,
  type ProblemGroupKey,
  REPORTING_LIMITS,
} from "../../../protocol/problems/mod.ts";

export const FEEDBACK_LIMITS = {
  text_scalars: REPORTING_LIMITS.feedback_text_scalars,
} as const;

export type FeedbackCaller = { actor: string; surface: string };

// 사람이 쓴 글은 인증된 shell의 user만 낼 수 있다. app·agent·다른 user 통로는
// 사람의 경험을 대신 쓸 수 없고, 거절 사유로 어떤 대상의 존재도 알리지 않는다.
export function requireShellUser(caller: FeedbackCaller): Result<void> {
  return caller.actor === "user" && caller.surface === "shell"
    ? ok(undefined)
    : err({
      code: "forbidden",
      message: "사람의 [문제 알리기]만 feedback을 접수한다",
    });
}

// redaction을 통과한 글은 공백 외 1~500 Unicode scalar여야 한다.
export function checkFeedbackText(text: string): Result<string> {
  const parsed = feedbackTextSchema.safeParse(text);
  return parsed.success ? ok(parsed.data) : err({
    code: "invalid_input",
    message: `글은 공백 외 1~${FEEDBACK_LIMITS.text_scalars}자여야 한다`,
  });
}

export type SelectedProblem = {
  id: string;
  app: string;
  group_key: ProblemGroupKey;
};

// 기존 문제에는 같은 앱의 live 문제를 명시적으로 골랐을 때만 덧붙인다. 그 밖에는 이 Report 자기
// ID로 새 문제를 만든다: 비슷한 글이나 같은 화면은 같은 결함의 증거가 아니다. 다른 앱의
// 문제와 없는 문제는 구별하지 않는다. "직접 해 봤지만 안 됩니다"도 이 경로의 새 Report다.
export function feedbackGroup(
  reportId: string,
  app: string,
  mode: "live" | "preview" | "test",
  selected: SelectedProblem | null,
): {
  group_key: ProblemGroupKey;
  existing_problem: string | null;
} {
  if (selected !== null && selected.app === app && mode === "live") {
    return {
      group_key: selected.group_key,
      existing_problem: selected.id,
    };
  }
  return {
    group_key: { kind: "feedback", discriminator: reportId },
    existing_problem: null,
  };
}
