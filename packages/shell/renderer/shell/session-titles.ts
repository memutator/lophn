// lophn session 이름의 순수 규칙. 탭 줄과 sidebar가 같이 쓴다. 정본은 창에 하나인 session 제목 값이고(`useKnownSessions`),
// 탭 제목은 정본이 아니다: 저장된 Agent 탭은 제목이 없고 그려지기 전의 탭은 agent 이름이다.

/** 다시 읽을 때를 정하는 값. session이 생기거나 끝날 때와 turn이 돌기 시작할 때 바뀐다. */
export function sessionTitlesKey(
  entries: readonly {
    readonly session: string;
    readonly ended: string | null;
    readonly state: string;
  }[],
): string {
  // 자동 제목은 첫 말을 접수할 때 붙고 event가 없다. session이 생긴 때(SessionStarted)에는 아직 없어서, 그 뒤
  // turn이 도는 것(TurnStarted)을 보고 다시 읽는다. 안 그러면 제목 없이 읽은 값이 화면을 다시 만들 때까지 남는다.
  return entries
    .map(
      (entry) =>
        `${entry.session}:${entry.ended ?? ""}:${entry.state === "running" ? 1 : 0}`,
    )
    .join();
}

/**
 * sidebar의 session 줄 이름. session 제목이 먼저이고, 제목이 아직 없으면 탭이 열린 줄은 탭 줄처럼 agent 이름,
 * 닫힌 줄은 `untitled`다. 탭 제목은 받지 않는다.
 */
export function sessionRowTitle(input: {
  readonly title: string | null | undefined;
  readonly open: boolean;
  readonly agentName: string;
  readonly untitled: string;
}): string {
  return input.title || (input.open ? input.agentName : input.untitled);
}
