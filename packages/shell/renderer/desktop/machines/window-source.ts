// shell preload의 `lophnMachines`를 화면의 MachinesSource로 옮긴다. main이 목록을 통째로 밀면 통째로 바꾼다.
// 이 창이 어느 기계의 것인지는 main이 정하고 창이 사는 동안 바뀌지 않아 처음에 한 번 묻는다.
import type { Id } from "../../../../protocol/base/ids.ts";
import type {
  LophnMachinesApi,
  MachineList,
  MachinesReply,
} from "../../../ipc/machines.ts";
import type { MachinesSource, MachinesView, SourceResult } from "./source.ts";

const STARTING: MachinesView = {
  state: "starting",
  thisComputer: null,
  machines: [],
  start: { mode: "last" },
  last: null,
};

function viewOf(list: MachineList): MachinesView {
  return {
    state: list.state,
    thisComputer: list.this,
    machines: list.machines.map((row) => ({
      id: row.id,
      name: row.name,
      announcedName: row.announced,
      alias: row.alias,
      status: row.status,
      path: row.path,
      lastSeenAt: row.last_seen_at,
    })),
    start: list.start,
    last: list.last,
  };
}

// main이 거절하면 약속이 그 code로 깨진다.
async function result(
  reply: Promise<MachinesReply>,
): Promise<SourceResult<void>> {
  try {
    const value = await reply;
    return value.ok
      ? { ok: true, value: undefined }
      : { ok: false, code: value.code };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

/** preload가 기계 통로를 열지 않은 창(gallery, mock)은 null이다. */
export async function windowMachinesSource(): Promise<MachinesSource | null> {
  const api = (globalThis as { lophnMachines?: LophnMachinesApi })
    .lophnMachines;
  if (api === undefined) return null;
  let view = STARTING;
  let pushed = false;
  const listeners = new Set<() => void>();
  api.onChanged((list) => {
    pushed = true;
    view = viewOf(list);
    for (const listener of listeners) listener();
  });
  const [list, own] = await Promise.all([
    api.list().catch(() => null),
    api.thisWindow(),
  ]);
  const win = own.machine;
  // 기다리는 사이 main이 민 목록이 더 새것이다.
  if (list !== null && !pushed) view = viewOf(list);
  const id = (machine: string) => machine as Id<"mch">;

  return {
    get: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // 이름은 별명을 바꾸면 따라간다.
    thisWindow: () =>
      win === null
        ? null
        : {
            id: win.id,
            name:
              view.machines.find((one) => one.id === win.id)?.name ?? win.name,
          },
    async pair(text) {
      try {
        return await api.pair(text);
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },
    remove: (machine) => result(api.remove(id(machine))),
    rename: (machine, alias) => result(api.rename(id(machine), alias)),
    setStart: (start) =>
      result(
        api.setStart(
          start.mode === "last"
            ? start
            : { mode: "machine", machine: id(start.machine) },
        ),
      ),
    open: (machine) => result(api.open(id(machine))),
  };
}
