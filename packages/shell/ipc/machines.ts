// The other computers in the person's device list that this desktop can view. This computer's core
// holds the connections (`machines/list`); shell main builds the list from it and the renderer reads the whole list and gets
// it again on every change. Adding, removing and renaming devices is Settings › Remote calling `roster/*` on the core.
import { z } from "zod";

import { type Id, idSchema } from "../../protocol/base/ids.ts";
import type { CoreReply } from "./core-api.ts";

export const MACHINES_LIST_CHANNEL = "shell:machines-list";
// main → renderer push: the whole list.
export const MACHINES_CHANGED_CHANNEL = "shell:machines-changed";
// Any desktop window clones another machine's project onto this computer (this computer's `project.clone`): the list's
// [Clone here].
export const MACHINES_CLONE_HERE_CHANNEL = "shell:machines-clone-here";

export const machineIdSchema = idSchema("mch") as unknown as z.ZodType<
  Id<"mch">
>;

export const machineRowSchema = z.strictObject({
  id: machineIdSchema,
  // The name in the device list, the same on every machine.
  name: z.string(),
  // `update`: the machine answers but the remote protocol versions do not meet; `update` says who must update (`client`:
  // lophn on this computer, `host`: lophn on that machine). Null in every other status.
  status: z.enum(["connecting", "connected", "offline", "update"]),
  update: z.enum(["client", "host"]).nullable(),
  path: z.enum(["direct", "relay"]).nullable(),
  last_seen_at: z.string().nullable(),
  lophn_version: z.string().nullable().optional(),
});
export type MachineRow = z.infer<typeof machineRowSchema>;

// 다른 기계의 연결 상태. IPC로 묻지 않고 목록의 줄에서 읽는다. 목록에 없는 기계(명단에서 빠짐)는 stale이다.
export function machineConnectionState(row: MachineRow | undefined): {
  state: "starting" | "ready" | "stale";
  confirmedAt: number | null;
} {
  const confirmedAt =
    row?.last_seen_at == null ? null : Date.parse(row.last_seen_at);
  if (row?.status === "connecting") return { state: "starting", confirmedAt };
  if (row?.status === "connected") return { state: "ready", confirmedAt };
  return { state: "stale", confirmedAt };
}

// `starting`: this machine's id or the core's machine list is not known yet. A machine that is not in a `ready` list left
// the device list.
export const machineListSchema = z.strictObject({
  state: z.enum(["starting", "ready"]),
  this: z.strictObject({ id: machineIdSchema, name: z.string() }).nullable(),
  machines: z.array(machineRowSchema),
});
export type MachineList = z.infer<typeof machineListSchema>;

export const machinesCloneHereSchema = z.strictObject({
  url: z.string().min(1).max(2048),
  identity: z.string().min(1),
  title: z.string().min(1),
});
export type MachinesCloneHere = z.infer<typeof machinesCloneHereSchema>;

export type MachinesFailure = {
  ok: false;
  code: "invalid_input" | "forbidden" | "not_found" | "unavailable";
};

/** The shell preload's `lophnMachines`. */
export interface LophnMachinesApi {
  /** Rejects with the error code when main refuses. */
  list(): Promise<MachineList>;
  onChanged(listener: (list: MachineList) => void): () => void;
  /**
   * This computer's `project.clone`. Without a projects folder main asks for a parent folder first; the core's reply comes
   * back as it is (a cancelled picker returns the `projects_folder_unset` failure).
   */
  cloneHere(input: MachinesCloneHere): Promise<CoreReply>;
}
