// The machine list the renderer reads, built from the saved list and the live link states, and the start machine rule.
import type { Id } from "../../../../protocol/base/ids.ts";
import {
  type ComputerItem,
  defaultName,
} from "../../../../remote-client/mod.ts";
import type { MachineList, MachineRow } from "../../../ipc/machines.ts";
import type { Saved } from "./store.ts";

export function machineList(input: {
  state: MachineList["state"];
  self: MachineList["this"];
  saved: Saved;
  // The computer store's items (by core key): live status and path.
  items: readonly ComputerItem[];
}): MachineList {
  const { saved } = input;
  const machines: MachineRow[] = [];
  for (const computer of saved.computers) {
    // Every entry this desktop pairs has the machine id from the hello.
    if (computer.machine === undefined) continue;
    const item = input.items.find((one) => one.key === computer.key);
    const status = item?.status ?? "connecting";
    machines.push({
      id: computer.machine,
      name: computer.name ?? computer.announced ?? defaultName(computer),
      announced: computer.announced ?? null,
      alias: computer.name ?? null,
      status: status === "revoked" ? "removed" : status,
      update: item?.update ?? null,
      path: item?.path ?? null,
      last_seen_at: saved.seen[computer.machine] ?? null,
    });
  }
  return {
    state: input.state,
    this: input.self,
    machines,
    start: saved.start,
    last: saved.last,
  };
}

// The machine the first window opens on: the chosen one, else the last used one, else this machine. One that left the
// list or was removed (it unpaired this desktop) does not count. Null while this machine's id is not known.
export function startMachine(list: MachineList): Id<"mch"> | null {
  if (list.this === null) return null;
  const usable = (id: Id<"mch"> | null) =>
    id !== null &&
    list.machines.some((one) => one.id === id && one.status !== "removed");
  if (list.start.mode === "machine" && usable(list.start.machine)) {
    return list.start.machine;
  }
  if (usable(list.last)) return list.last as Id<"mch">;
  return list.this.id;
}

// After a machine leaves the list: a start pinned to it goes back to "last used", and "last used" becomes this machine.
export function afterRemove(
  saved: Saved,
  machine: Id<"mch">,
  self: Id<"mch">,
): Saved {
  const { [machine]: _gone, ...seen } = saved.seen;
  return {
    ...saved,
    start:
      saved.start.mode === "machine" && saved.start.machine === machine
        ? { mode: "last" }
        : saved.start,
    last: saved.last === machine ? self : saved.last,
    seen,
  };
}
