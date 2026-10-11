// questions contract의 답 입력 schema를 테스트 실행 중에만 불러온다. renderer 설정으로는 contracts를
// type check하지 않으므로(message-contract.ts와 같은 이유) 계산한 경로로 불러 필요한 모양만 적는다.

export interface QuestionContract {
  readonly answerQuestionGroupInputSchema: {
    safeParse(value: unknown): { success: boolean };
  };
}

export async function questionContract(): Promise<QuestionContract> {
  const url = new URL(
    "../../../../../packages/contracts/lophn-agent/questions.ts",
    import.meta.url,
  );
  return await import(url.href) as QuestionContract;
}
