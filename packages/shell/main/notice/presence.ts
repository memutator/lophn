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

export type MachinePresenceDeps = {
  /** 그 기계(null이 이 컴퓨터)에 알릴 것. */
  view(machine: string | null): PresenceView;
  idleMs(): number;
  send(
    machine: string | null,
    report: PresenceView & { idle_ms: number },
  ): void;
  every(ms: number, fn: () => void): () => void;
};

/**
 * 이 창들이 보는 것을 기계마다 그 기계에 알린다. 보이는 session은 기계마다 달라 보고도 기계마다 짓는다. 알릴 기계가 들어오면
 * 주기에 들고, 빠진 기계는 거둔다.
 */
export function createMachinePresence(deps: MachinePresenceDeps): {
  /** 알릴 기계 전부(이 컴퓨터는 null). */
  machines(list: readonly (string | null)[]): void;
  changed(): void;
  /** 바뀌지 않았어도 한 기계에 보낸다(그 기계에 다시 붙었을 때). */
  report(machine: string | null): void;
  stop(): void;
} {
  const reporters = new Map<
    string | null,
    ReturnType<typeof createPresenceReporter>
  >();
  return {
    machines(list) {
      for (const machine of list) {
        if (reporters.has(machine)) continue;
        const reporter = createPresenceReporter({
          view: () => deps.view(machine),
          idleMs: deps.idleMs,
          send: (report) => deps.send(machine, report),
          every: deps.every,
        });
        reporters.set(machine, reporter);
      }
      for (const [machine, reporter] of [...reporters]) {
        if (list.includes(machine)) continue;
        reporter.stop();
        reporters.delete(machine);
      }
    },
    changed() {
      for (const reporter of reporters.values()) reporter.changed();
    },
    report: (machine) => reporters.get(machine)?.report(),
    stop() {
      for (const reporter of reporters.values()) reporter.stop();
      reporters.clear();
    },
  };
}
