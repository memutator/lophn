// core가 resume으로 연 터미널이 쥔 harness agent의 ledger session이다. 쥔 동안 그 session에 headless turn이 시작하지 않는다(한 CLI
// session에 process 둘을 띄우지 않는다). `tui`는 agent가 `tabs/open {tui}`로 연 터미널이라 그 harness가 foreground에 보인 뒤 떠나면
// 푼다(CLI가 끝내 안 떠도 터미널이 끝날 때까지 쥔다: 오류는 터미널에 보인다). `gui`는 `coding_sessions/open`의 resume으로 연
// 터미널이라 터미널이 끝날 때까지 쥔다(GUI를 터미널로 바꿔도 쥔다). 쥔 session 목록이 바뀔 때와 주기로 `beat`를 부른다.
export function createTerminalHolds(deps: {
  // tracker: foreground의 harness TUI가 떠났거나 터미널이 끝났다(TUI가 보인 적이 있을 때만).
  onForegroundExit(terminalRef: string, listener: () => void): () => void;
  // 지금 쥔 session 전부로 hold를 갱신한다(`HarnessHold.heartbeat`).
  beat(sessions: readonly string[]): void;
}) {
  const holds = new Map<string, { session: string; stop: () => void }>();
  const sessions = () => [
    ...new Set([...holds.values()].map((one) => one.session)),
  ];
  const beat = () => deps.beat(sessions());

  function release(terminalRef: string): void {
    const found = holds.get(terminalRef);
    if (found === undefined) return;
    found.stop();
    holds.delete(terminalRef);
    beat();
  }

  return {
    hold(terminalRef: string, session: string, mode: "tui" | "gui"): void {
      holds.get(terminalRef)?.stop();
      holds.set(terminalRef, {
        session,
        stop:
          mode === "tui"
            ? deps.onForegroundExit(terminalRef, () => release(terminalRef))
            : () => {},
      });
      beat();
    },
    // 터미널이 끝났다.
    release,
    beat,
    sessions,
  };
}
