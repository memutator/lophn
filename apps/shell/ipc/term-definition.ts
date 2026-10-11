// app.create·apply_settings 선택지의 답. renderer는 질문과 고른 선택지만 보내고, main이 정본을 다시 읽어
// 확인 창 없이 AnswerQuestionAction으로 접수한다. action 입력은 이 통로에 싣지 않는다.

export const TERM_DEFINITION_CHANNEL = "questions:confirm-term";

export type TermDefinitionReply =
  | { ok: true }
  | {
    ok: false;
    code:
      | "forbidden"
      | "invalid_input"
      | "conflict"
      | "not_found"
      | "unavailable";
  };

export interface TermDefinitionApi {
  confirmTermDefinition(input: {
    question: string;
    option_key: string;
  }): Promise<TermDefinitionReply>;
}
