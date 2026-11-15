// agent가 `lophn tab open --session --tui`로 연 TUI 탭의 표다(tab → lophn session). 탭이 창에 생긴 순간부터 그 session은 hold되어야
// 하므로(탭이 열린 동안 headless turn이 시작하지 않는다) 터미널이 아직 안 열렸어도 든다. surface wiring이 이 목록을 `/host-link`의
// `visible`에 실어 core의 hold를 이어 간다. 풀리는 때는 탭이 닫혔을 때, 창이 닫혔을 때, 또는 CLI가 foreground에 보인 뒤 떠났을 때다
// (CLI가 끝내 안 떠도 사람이 탭을 닫을 때까지 풀지 않는다: 오류는 터미널에 보인다).
// Electron도 core도 모르고 deps로만 일한다.
export type HarnessTuiDeps = {
  /** tracker: foreground의 harness TUI가 떠났거나 터미널이 끝났다(TUI가 보인 적이 있을 때만). 돌려받은 함수로 그만 듣는다. */
  onForegroundExit(terminalRef: string, listener: () => void): () => void;
};

type Entry = {
  session: string;
  /** 알린 창(webContents id). */
  owner: number;
  stop: (() => void) | null;
};

export function createHarnessTui(deps: HarnessTuiDeps) {
  const tabs = new Map<string, Entry>();
  // 폰이 `coding_open`의 resume으로 연 터미널이 쥔 ledger session(key는 그 열기 하나). 같은 hold다: 그 CLI가 도는 동안 headless turn이
  // 같은 CLI session에 둘째 process를 띄우지 않는다.
  const guis = new Map<string, string>();

  function release(tab: string): void {
    tabs.get(tab)?.stop?.();
    tabs.delete(tab);
  }

  return {
    /** TUI 탭이 창에 생겼다. */
    open(tab: string, session: string, owner: number): void {
      release(tab);
      tabs.set(tab, { session, owner, stop: null });
    },
    /** 그 탭의 터미널이 열렸다. 이 터미널에서 TUI가 떠나면 푼다. */
    bind(tab: string, terminalRef: string): void {
      const entry = tabs.get(tab);
      if (entry === undefined) return;
      entry.stop?.();
      entry.stop = deps.onForegroundExit(terminalRef, () => release(tab));
    },
    /** 탭이 닫혔다(없는 탭이면 아무것도 안 한다). */
    release,
    /** 창이 닫혔다. 그 창이 알린 탭은 닫힘을 알릴 수 없다. */
    closeWindow(owner: number): void {
      for (const [tab, entry] of [...tabs]) {
        if (entry.owner === owner) release(tab);
      }
    },
    /** resume으로 연 GUI가 그 ledger session을 쥔다. 여는 동안부터 그 터미널이 끝날 때까지다(GUI를 터미널로 바꿔도 쥔다). */
    holdGui(key: string, session: string): void {
      guis.set(key, session);
    },
    releaseGui(key: string): void {
      guis.delete(key);
    },
    /** 지금 hold해야 하는 session: TUI 탭이 열려 있거나 resume으로 연 GUI가 쥔 것. */
    sessions: (): string[] => [
      ...new Set([
        ...[...tabs.values()].map((entry) => entry.session),
        ...guis.values(),
      ]),
    ],
  };
}

export type HarnessTui = ReturnType<typeof createHarnessTui>;
