// The machine list the renderer reads, built from this computer's core (`machines/list`).
import type { z } from "zod";

import type { Id } from "../../../../protocol/base/ids.ts";
import type { machinesList } from "../../../../protocol/remote/routes.ts";
import type { MachineList } from "../../../ipc/machines.ts";

/** One row of `machines/list`. */
export type LinkedMachine = z.infer<
  typeof machinesList.output
>["machines"][number];

export function machineList(input: {
  state: MachineList["state"];
  self: MachineList["this"];
  machines: readonly LinkedMachine[];
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
  };
}
