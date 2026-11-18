// harness의 headless CLI 하나를 돌리는 규칙의 모양이다. 순수 값이고 IO는 없다.
// 실행(spawn, 기록)은 core 안 extension host에서 도는 extension `harness`가 한다.

// 구조 출력의 한 줄이 내는 것. 끝은 `end`가 없으면 process 종료(exit 0이면 completed)다.
export type HeadlessEvent =
  | { kind: "session"; id: string }
  | { kind: "text"; text: string }
  // 끝난 tool 하나. 도는 중인 tool은 내지 않는다(기록한 part를 고칠 길이 없다).
  | { kind: "tool"; name: string; summary: string; status: "done" | "failed" }
  | { kind: "end"; ok: boolean; error?: string };

// 줄 하나를 읽는다. run 하나에 하나씩 만든다(claude는 tool_use와 tool_result를 id로 짝지어야 해서 상태가 있다).
export type HeadlessParser = (line: string) => HeadlessEvent[];

export type HeadlessSpec = {
  command: string;
  // true면 cwd가 자기 git root가 아닐 때 띄우지 않는다. 이 harness가 cwd가 아니라 그 위 git root에 쓰기 때문이다.
  needsOwnGitRoot?: true;
  // cwd는 spawn 옵션으로 넘긴다. `deny`는 `permissions`가 옮긴 flag다.
  args(input: {
    prompt: string;
    sessionId: string | null;
    // sessionId가 null일 때 갈라 시작할 harness session. fork를 headless로 못 하는 harness는 무시하고 새로 시작한다.
    forkFrom: string | null;
    deny: readonly string[];
  }): string[];
  // 정의의 `permissions.deny`(`lophn(<앱 slug> <command 낱말>)`)를 이 harness의 금지 flag로 옮긴다.
  // 옮길 수 없으면 null이다. 규칙을 지키지 못하는 채로 띄우지 않기 위해서다.
  permissions(rules: readonly string[]): string[] | null;
  parser(): HeadlessParser;
};
