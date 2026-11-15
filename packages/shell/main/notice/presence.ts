// desktop이 지금 무엇을 보고 있는지 core에 알린다(`presence/report`). core가 못 본 turn 끝(`unseen`)과 push를 정할 때 쓴다.
// Electron을 모르고 deps로만 일한다.

/** 30초마다 늘 다시 보낸다. core는 90초 지난 보고를 없는 것으로 보고, 다시 뜬 core도 이 주기가 채운다. */
export const PRESENCE_INTERVAL_MS = 30_000;

export type PresenceView = {
  /** lophn 창에 focus가 있다. */
  focused: boolean;
  /** focus를 가진 창에 보이는 session과 터미널(`term:<탭>`). */
  looking: string[];
};

export type PresenceDeps = {
  view(): PresenceView;
  /** 마지막 입력 뒤 지난 시간(ms). */
  idleMs(): number;
  send(report: PresenceView & { idle_ms: number }): void;
  every(ms: number, fn: () => void): () => void;
};

export function createPresenceReporter(deps: PresenceDeps): {
  /** focus나 보이는 것이 바뀌었을 수 있다. 바뀌었을 때만 보낸다. */
  changed(): void;
  /** 바뀌지 않았어도 보낸다(core가 다시 붙었을 때). */
  report(): void;
  stop(): void;
} {
  let last = "";

  function send(force: boolean): void {
    const view = deps.view();
    const looking = [...new Set(view.looking)].sort().slice(0, 32);
    // idle_ms는 늘 바뀌어 바뀜 판단에서 뺀다.
    const key = JSON.stringify([view.focused, looking]);
    if (!force && key === last) return;
    last = key;
    // 실패는 다음 주기가 메운다.
    deps.send({
      focused: view.focused,
      idle_ms: Math.max(0, Math.round(deps.idleMs())),
      looking,
    });
  }

  const stop = deps.every(PRESENCE_INTERVAL_MS, () => send(true));
  return {
    changed: () => send(false),
    report: () => send(true),
    stop,
  };
}
