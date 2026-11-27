// shell preload의 `lophnMachines`를 화면의 MachinesSource로 옮긴다. main이 목록을 통째로 밀면 통째로 바꾼다.
import type { LophnMachinesApi, MachineList } from "../../../ipc/machines.ts";
import type { CoreReply } from "../../../ipc/core-api.ts";
import type {
  CloneHereOutcome,
  MachinesSource,
  MachinesView,
} from "./source.ts";

const STARTING: MachinesView = {
  state: "starting",
  thisComputer: null,
  machines: [],
};

function viewOf(list: MachineList): MachinesView {
  return {
    state: list.state,
    thisComputer: list.this,
    machines: list.machines.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      update: row.update,
      path: row.path,
      lastSeenAt: row.last_seen_at,
      lophnVersion: row.lophn_version ?? null,
    })),
  };
}

function cloneOutcome(reply: CoreReply): CloneHereOutcome {
  if (reply.ok)
    return { ok: true, path: (reply.value as { path: string }).path };
  const details = reply.error?.details;
  if (details?.["reason"] === "projects_folder_unset") {
    return { ok: false, reason: "cancelled" };
  }
  if (details?.["reason"] === "git_auth") {
    return {
      ok: false,
      reason: "git_auth",
      command: String(details["command"]),
    };
  }
  return { ok: false, reason: "failed", message: reply.error?.message ?? "" };
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
  const list = await api.list().catch(() => null);
  // 기다리는 사이 main이 민 목록이 더 새것이다.
  if (list !== null && !pushed) view = viewOf(list);

  return {
    get: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cloneHere: async (input) => cloneOutcome(await api.cloneHere(input)),
  };
}
