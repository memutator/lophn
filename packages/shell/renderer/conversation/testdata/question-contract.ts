// questions contract의 답 입력 schema를 테스트 실행 중에만 불러온다. renderer 설정으로는 contracts를
// type check하지 않으므로(message-contract.ts와 같은 이유) 계산한 경로로 불러 필요한 모양만 적는다.
// tsx test는 esbuild bundle 안에서 돌아 `import.meta.url`이 bundle 자리를 가리키므로, 경로는 test를
// 돌리는 repo root(작업 폴더)에서 계산한다.

export interface QuestionContract {
  readonly answerQuestionGroupInputSchema: {
    safeParse(value: unknown): { success: boolean };
  };
}

interface DenoCwd {
  readonly Deno: { cwd(): string };
}

export async function questionContract(): Promise<QuestionContract> {
  const root = (globalThis as unknown as DenoCwd).Deno.cwd();
  const url = new URL(
    "packages/contracts/lophn-agent/questions.ts",
    `file://${root}/`,
  );
  return await import(url.href) as QuestionContract;
}
