// agent가 `lophn tab open --session --tui`로 연 터미널의 terminal_ref → lophn session 표다. 이 표에 든 session은 그 터미널에서
// harness TUI가 도는 동안이다. extension `harness`가 매 tick 이 목록을 core에 실어(`harness/take {tui}`) hold를 이어 간다.
// Electron도 core도 모르고 deps로만 일한다.
const SEEN_MS = 30_000;

export type HarnessTuiDeps = {
  /** tracker: foreground의 harness TUI가 떠났거나 터미널이 끝났다. 돌려받은 함수로 그만 듣는다. */
  onForegroundExit(terminalRef: string, listener: () => void): () => void;
  /** tracker: 그 터미널의 foreground에 harness TUI가 보인다. */
  tuiRunning(terminalRef: string): boolean;
  after(ms: number, run: () => void): () => void;
};

export function createHarnessTui(deps: HarnessTuiDeps) {
  const bound = new Map<string, { session: string; stop: () => void }>();

  function release(terminalRef: string): void {
    bound.get(terminalRef)?.stop();
    bound.delete(terminalRef);
  }

  return {
    /** 터미널이 열렸다. TUI가 뜨기를 기다린다. 30초 안에 foreground에 안 보이면 지운다(resume이 실패했거나 사람이 지웠다). */
    bind(terminalRef: string, session: string): void {
      release(terminalRef);
      const offExit = deps.onForegroundExit(terminalRef, () =>
        release(terminalRef),
      );
      const cancel = deps.after(SEEN_MS, () => {
        if (!deps.tuiRunning(terminalRef)) release(terminalRef);
      });
      bound.set(terminalRef, {
        session,
        stop() {
          offExit();
          cancel();
        },
      });
    },
    /** 지금 TUI가 도는 session. */
    sessions: (): string[] => [
      ...new Set([...bound.values()].map((entry) => entry.session)),
    ],
  };
}

export type HarnessTui = ReturnType<typeof createHarnessTui>;
