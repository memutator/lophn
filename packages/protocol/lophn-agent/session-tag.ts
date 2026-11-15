// session 표지: 앱이 process 목록에서 session의 process를 찾는 환경 변수다. 의존이 없어 terminal-host(PTY를 띄우는 process)도 쓴다.
// 값은 session 목록의 `session`과 같다. core session은 `ses_…`(agent의 shell과 headless CLI), 터미널 탭은 `term:<탭>`이다.
// secret이 아니다. 이 값을 읽어 "agent session 안이다"로 판단하는 code는 없다(`LOPHN_AGENT_SHELL`이 그 표시다).
export const SESSION_ENV_NAME = "LOPHN_SESSION_ID";
export const TERMINAL_SESSION_PREFIX = "term:";

/** 터미널 탭의 session id. 탭의 shell과 그 아래 CLI(TUI, GUI가 띄운 CLI)가 `SESSION_ENV_NAME`으로 가진다. */
export function terminalSessionId(terminalRef: string): string {
  return `${TERMINAL_SESSION_PREFIX}${terminalRef}`;
}

/**
 * 터미널 탭의 coding agent 대화(GUI 화면, 폰의 coding session)가 쓰는 ACP session id. 탭의 `trm_<ULID>`에서 만들어 toggle로
 * handle(`win_<ULID>`)이 바뀌어도 같다. ACP 입력이 session을 `ses_<ULID>`로 검사하므로 ULID만 옮긴다(`ses_trm_…`이면 모든
 * 입력이 거절된다). shell이 이 id를 정하고 core는 만들지 않는다. ledger에는 이 id의 행이 없다.
 */
export function guiSessionId(terminalRef: string): string {
  return `ses_${terminalRef.slice(terminalRef.indexOf("_") + 1)}`;
}
