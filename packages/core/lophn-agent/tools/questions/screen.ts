import type {
  RedactionInput,
  RedactionResult,
} from "../../../../protocol/server/mod.ts";

// 질문의 자유 답은 blob으로 준비하기 전에 secret인지 먼저 본다(R11). 비밀번호·API
// key·token 평문은 일반 저장(blob·세션·model 입력·event)에 들어가지 않는다. 판정은
// platform/redaction이 하고 이 파일은 그 결과를 답의 길로 바꾼다. 판정을 못 하면
// 막는다(fail closed, 질문 Q23): 그 답은 저장되지 않고 질문은 미답으로 남는다.

// platform/redaction 엔진의 redact와 같은 모양이다. 조립이 실제 엔진을 건다.
export type AnswerRedactor = (
  input: RedactionInput,
  body: string,
) => Promise<RedactionResult>;

// secret은 질문으로 받지 않고 platform/secrets의 보호 입력으로 안내한다.
export type SecureInputGuidance = {
  route: "platform/secrets";
  input: "protected_input";
};

export type AnswerScreen =
  // 일반 저장해도 되는 답 글이다.
  | { status: "accepted"; text: string }
  // 빈 답·공백만 있는 답은 답이 아니다(R6).
  | { status: "blank" }
  // secret으로 판정했다. 글을 돌려주지 않고 보호 입력을 안내한다.
  | { status: "secure_input"; guidance: SecureInputGuidance }
  // 판정을 하지 못했다. 저장하지 않는다.
  | { status: "unavailable" };

export const SECURE_INPUT_GUIDANCE: SecureInputGuidance = {
  route: "platform/secrets",
  input: "protected_input",
};

// 질문 답의 redaction 입력. 엔진은 question_answer 범위에서 비밀로 보이는 부분이
// 하나라도 있으면 제출 전체를 막는다.
export const ANSWER_REDACTION_INPUT: RedactionInput = {
  source: {
    concern: "lophn-agent/questions",
    revision: "1",
    scope: "question_answer",
  },
  media_type: "text/plain",
  audience: "storage",
  safe_fields: [],
  private_fields: [],
};

export async function screenAnswerText(
  body: string,
  redact: AnswerRedactor,
): Promise<AnswerScreen> {
  if (body.trim().length === 0) return { status: "blank" };
  let result: RedactionResult;
  try {
    result = await redact(ANSWER_REDACTION_INPUT, body);
  } catch {
    return { status: "unavailable" };
  }
  if (
    result.omissions.some((omission) => omission.reason === "secret_detected")
  ) {
    return { status: "secure_input", guidance: SECURE_INPUT_GUIDANCE };
  }
  if (
    result.status === "passed" && result.content !== null &&
    result.content.kind === "inline"
  ) {
    return { status: "accepted", text: result.content.value };
  }
  return { status: "unavailable" };
}
