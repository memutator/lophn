// The machine list the renderer reads, built from this computer's core (`machines/list`) and the saved start machine.
import type { z } from "zod";

import type { Id } from "../../../../protocol/base/ids.ts";
import type { machinesList } from "../../../../protocol/remote/routes.ts";
import type { MachineList } from "../../../ipc/machines.ts";
import type { StartFile } from "./start.ts";

/** One row of `machines/list`. */
export type LinkedMachine = z.infer<
  typeof machinesList.output
>["machines"][number];

export type Saved = Pick<StartFile, "start" | "last" | "last_name">;

export function machineList(input: {
  state: MachineList["state"];
  self: MachineList["this"];
  machines: readonly LinkedMachine[];
  saved: Saved;
}): MachineList {
  return {
    state: input.state,
    this: input.self,
    machines: input.machines.map((one) => ({
      id: one.machine as Id<"mch">,
      name: one.name,
      status: one.status,
      update: one.update,
      path: one.path,
      last_seen_at: one.last_seen_at,
    })),
    start: input.saved.start,
    last: input.saved.last,
  };
}

// After this computer removes a machine from the device list: a start pinned to it goes back to "last used", and "last
// used" becomes this machine.
export function afterRemove(
  saved: Saved,
  machine: Id<"mch">,
  self: Id<"mch">,
): Saved {
  return {
    start:
      saved.start.mode === "machine" && saved.start.machine === machine
        ? { mode: "last" }
        : saved.start,
    last: saved.last === machine ? self : saved.last,
    last_name: saved.last === machine ? null : saved.last_name,
  };
}
