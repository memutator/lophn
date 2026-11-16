// 기계 보기의 가짜 통로. 메모리에 두고 gallery가 목록, 시작 기계, 이 창의 기계, pair의 결과를 고정한다.
import type {
  CloneHereOutcome,
  MachineItem,
  MachinesSource,
  MachinesView,
  PairOutcome,
} from "../source.ts";

export const THIS_COMPUTER = { id: "mch_studio", name: "Studio" } as const;

const HOUR = 60 * 60 * 1000;

/** 화면 확인용 대표 셋: 붙어 있음(relay), 꺼져 있음, 상대가 지웠음. */
export function sampleMachines(now = Date.now()): MachineItem[] {
  return [
    {
      id: "mch_homeserver",
      name: "Home server",
      announcedName: "Mac mini",
      alias: "Home server",
      status: "connected",
      update: null,
      path: "relay",
      lastSeenAt: new Date(now).toISOString(),
    },
    {
      id: "mch_laptop",
      name: "Work laptop",
      announcedName: "Work laptop",
      alias: null,
      status: "offline",
      update: null,
      path: null,
      lastSeenAt: new Date(now - 3 * HOUR).toISOString(),
    },
    {
      id: "mch_olddesk",
      name: "Old desktop",
      announcedName: "Old desktop",
      alias: null,
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
  /** `pair`의 결과. 없으면 성공하고 "Studio PC"가 목록에 선다. */
  pair?: PairOutcome;
  /** 다른 기계의 창이 읽는 이 컴퓨터의 답. 없으면 unavailable이다. */
  thisRead?: (
    route: "project.list" | "ListSessions",
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
    machines: options.machines ?? sampleMachines(),
    start: options.start ?? { mode: "last" },
    last: null,
  };
  const listeners = new Set<() => void>();
  const set = (next: Partial<MachinesView>) => {
    view = { ...view, ...next };
    for (const listener of listeners) listener();
  };
  const ok = () => Promise.resolve({ ok: true as const, value: undefined });
  const missing = (id: string) =>
    view.machines.some((one) => one.id === id)
      ? null
      : Promise.resolve({ ok: false as const, code: "not_found" });
  const opened: string[] = [];

  const source: MachinesSource = {
    get: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    thisWindow: () => options.window ?? null,
    async pair() {
      const outcome = options.pair ?? { ok: true, machine: "mch_studiopc" };
      if (
        outcome.ok &&
        !view.machines.some((one) => one.id === outcome.machine)
      ) {
        set({
          machines: [
            ...view.machines,
            {
              id: outcome.machine,
              name: "Studio PC",
              announcedName: "Studio PC",
              alias: null,
              status: "connected",
              update: null,
              path: "direct",
              lastSeenAt: new Date().toISOString(),
            },
          ],
        });
      }
      return outcome;
    },
    remove(id) {
      const gone = missing(id);
      if (gone !== null) return gone;
      set({
        machines: view.machines.filter((one) => one.id !== id),
        start:
          view.start.mode === "machine" && view.start.machine === id
            ? { mode: "last" }
            : view.start,
      });
      return ok();
    },
    rename(id, alias) {
      const gone = missing(id);
      if (gone !== null) return gone;
      set({
        machines: view.machines.map((one) =>
          one.id === id
            ? {
                ...one,
                alias,
                name: alias ?? one.announcedName ?? one.name,
              }
            : one,
        ),
      });
      return ok();
    },
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
