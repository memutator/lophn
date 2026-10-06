// lophn-agent questions contract를 테스트 실행 중에만 불러온다. renderer 설정(lib
// ES2023·DOM)으로는 contracts·base를 type check하지 않으므로 정적 import 대신 계산한
// 경로로 불러 필요한 모양만 적는다. 칸이 보내는 답·취소 입력과 글 상한이 contract와 같은지 본다.

interface Schema {
  safeParse(value: unknown): { success: boolean };
}

export interface QuestionContract {
  readonly QUESTION_TEXT_MAX_BYTES: number;
  readonly answerQuestion: { readonly input: Schema };
  readonly answerQuestionAction: {
    readonly input: Schema;
    readonly binding: readonly string[];
  };
  readonly cancelQuestion: { readonly input: Schema };
  readonly deferQuestion: { readonly input: Schema };
  readonly questionText: { readonly input: Schema };
}

export async function questionContract(): Promise<QuestionContract> {
  const url = new URL(
    "../../../../../../../packages/contracts/lophn-agent/mod.ts",
    import.meta.url,
  );
  return await import(url.href) as QuestionContract;
}
