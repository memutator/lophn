// session 표지: 앱이 process 목록에서 session의 process를 찾는 환경 변수다. 의존이 없어 terminal-host(PTY를 띄우는 process)도 쓴다.
// 값은 session 목록의 `session`과 같다. core session은 `ses_…`(agent의 shell과 headless CLI), 터미널 탭은 `term:<탭>`이다.
// secret이 아니다. 이 값을 읽어 "agent session 안이다"로 판단하는 code는 없다(`LOPHN_AGENT_SHELL`이 그 표시다).
export const SESSION_ENV_NAME = "LOPHN_SESSION_ID";
export const TERMINAL_SESSION_PREFIX = "term:";

/** 터미널 탭의 session id. 탭의 shell과 그 아래 CLI(TUI, GUI가 띄운 CLI)가 `SESSION_ENV_NAME`으로 가진다. */
export function terminalSessionId(terminalRef: string): string {
  return `${TERMINAL_SESSION_PREFIX}${terminalRef}`;
}
