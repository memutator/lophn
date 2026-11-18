// 기계 보기의 가짜 통로. 메모리에 두고 gallery가 목록을 고정한다.
import type {
  CloneHereOutcome,
  MachineItem,
  MachinesSource,
  MachinesView,
} from "../source.ts";

export const THIS_COMPUTER = { id: "mch_studio", name: "Studio" } as const;

const HOUR = 60 * 60 * 1000;

/** 화면 확인용 대표 셋: 붙어 있음(relay), 꺼져 있음, 명단에서 빠졌음. */
export function sampleMachines(now = Date.now()): MachineItem[] {
  return [
    {
      id: "mch_homeserver",
      name: "Home server",
      status: "connected",
      update: null,
      path: "relay",
      lastSeenAt: new Date(now).toISOString(),
    },
    {
      id: "mch_laptop",
      name: "Work laptop",
      status: "offline",
      update: null,
      path: null,
      lastSeenAt: new Date(now - 3 * HOUR).toISOString(),
    },
    {
      id: "mch_olddesk",
      name: "Old desktop",
      status: "removed",
      update: null,
      path: null,
      lastSeenAt: new Date(now - 50 * HOUR).toISOString(),
    },
  ];
}

export interface FakeMachinesOptions {
  /** 처음 목록. 없으면 대표 셋이고 `[]`이면 짝지은 기계가 없다. */
  machines?: readonly MachineItem[];
  state?: MachinesView["state"];
  /** `cloneHere`의 결과. 없으면 ~/projects 아래에 받는다. */
  clone?: CloneHereOutcome;
}

export function fakeMachines(options: FakeMachinesOptions = {}) {
  const state = options.state ?? "ready";
  const view: MachinesView = {
    state,
    thisComputer: state === "starting" ? null : THIS_COMPUTER,
    // 명단에서 빠진 기계는 목록에 없다.
    machines: (options.machines ?? sampleMachines()).filter(
      (one) => one.status !== "removed",
    ),
  };
  const listeners = new Set<() => void>();

  const source: MachinesSource = {
    get: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cloneHere: (input) =>
      Promise.resolve(
        options.clone ?? { ok: true, path: `/home/me/projects/${input.title}` },
      ),
  };
  return { source };
}
