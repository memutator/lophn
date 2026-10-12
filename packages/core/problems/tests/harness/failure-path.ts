// 앱이 낸 실패 경로 test 한 건. 선언 code를 실제 command 호출로 재현하는 입력이다. `direct`는 SDK만
// 직접 부르는 test라서 통과하지 못한다.
export type HarnessFailurePath = {
  code: string;
  command?: string;
  input?: unknown;
  fault?: "store" | "net" | "none";
  direct?: boolean;
};
