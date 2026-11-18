// 기계 보기의 가짜 통로. 메모리에 두고 gallery가 목록, 시작 기계, 이 창의 기계를 고정한다.
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
  /** 처음 시작 기계. 없으면 마지막에 쓴 기계다. */
  start?: MachinesView["start"];
  /** 이 창이 보는 기계. 없거나 null이면 이 컴퓨터의 창이다. */
  window?: { id: string; name: string } | null;
  /** 다른 기계의 창이 읽는 이 컴퓨터의 답. 없으면 unavailable이다. */
  thisRead?: (
    route: "project.list" | "ListAgents" | "ListSessions",
    input: unknown,
  ) => unknown;
  /** `cloneHere`의 결과. 없으면 ~/projects 아래에 받는다. */
  clone?: CloneHereOutcome;
}

export function fakeMachines(options: FakeMachinesOptions = {}) {
  const state = options.state ?? "ready";
  let view: MachinesView = {
    state,
    thisComputer: state === "starting" ? null : THIS_COMPUTER,
    // 명단에서 빠진 기계는 목록에 없고 그 기계의 창(`window`)만 removed gate를 보인다.
    machines: (options.machines ?? sampleMachines()).filter(
      (one) => one.status !== "removed",
    ),
    start: options.start ?? { mode: "last" },
    last: null,
  };
  const listeners = new Set<() => void>();
  const set = (next: Partial<MachinesView>) => {
    view = { ...view, ...next };
    for (const listener of listeners) listener();
  };
  const ok = () => Promise.resolve({ ok: true as const, value: undefined });
  const opened: string[] = [];

  const source: MachinesSource = {
    get: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    thisWindow: () => options.window ?? null,
    setStart(start) {
      set({ start });
      return ok();
    },
    open(id) {
      opened.push(id);
      return ok();
    },
    thisRead: (route, input) =>
      Promise.resolve(
        options.thisRead === undefined
          ? { ok: false, code: "unavailable" }
          : { ok: true, value: options.thisRead(route, input) },
      ),
    cloneHere: (input) =>
      Promise.resolve(
        options.clone ?? { ok: true, path: `/home/me/projects/${input.title}` },
      ),
  };
  return { source, opened };
}
