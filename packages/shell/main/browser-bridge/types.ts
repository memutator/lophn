// terminal IPC가 browser bridge를 부르는 모양.
export interface TerminalBridge {
  /** 새 shell에 줄 env. bridge가 꺼졌거나 사용자가 BROWSER를 두었으면 null. 이 호출은 key를 만들 뿐 표에 넣지 않는다. */
  issue(): { key: string; env: Record<string, string> } | null;
  /** open이 성공한 뒤 key를 그 terminal에 묶는다. 묶이지 않은 key의 요청은 declined다. */
  bind(key: string, terminalRef: string): void;
  /** 탭을 닫아 terminal이 끝났다. 그 terminal의 key를 버린다. */
  revoke(terminalRef: string): void;
  /** terminal에서 Ctrl/Cmd-click한 link. 설정에 따라 browser 탭 또는 OS browser로 연다. */
  openLink(input: { terminal_ref: string; url: string }): Promise<void>;
  /** renderer가 bridge push를 받아 browser 탭을 열었다고 답했다. */
  ack(request: string, opened: boolean): void;
}
