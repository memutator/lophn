// The machines this desktop views (other machines' lophn it is paired with as a desktop device) and the start machine.
// shell main holds the connections and the saved list; the renderer reads the whole list and gets it again on every change.
import { z } from "zod";

import { type Id, idSchema } from "../../protocol/base/ids.ts";

export const MACHINES_LIST_CHANNEL = "shell:machines-list";
// main → renderer push: the whole list.
export const MACHINES_CHANGED_CHANNEL = "shell:machines-changed";
export const MACHINES_PAIR_CHANNEL = "shell:machines-pair";
export const MACHINES_REMOVE_CHANNEL = "shell:machines-remove";
export const MACHINES_RENAME_CHANNEL = "shell:machines-rename";
export const MACHINES_START_CHANNEL = "shell:machines-start";

export const machineIdSchema = idSchema("mch") as unknown as z.ZodType<
  Id<"mch">
>;

export const machineStartSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("last") }),
  z.strictObject({ mode: z.literal("machine"), machine: machineIdSchema }),
]);
export type MachineStart = z.infer<typeof machineStartSchema>;

export const machineRowSchema = z.strictObject({
  id: machineIdSchema,
  // Shown: the alias, else the announced name, else the address.
  name: z.string(),
  announced: z.string().nullable(),
  alias: z.string().nullable(),
  status: z.enum(["connecting", "connected", "offline", "removed"]),
  path: z.enum(["direct", "relay"]).nullable(),
  last_seen_at: z.string().nullable(),
});
export type MachineRow = z.infer<typeof machineRowSchema>;

// `starting`: this machine's id is not known yet (core has not answered). `unreadable`: the saved files could not be read;
// they are left as they are and viewing other machines is off.
export const machineListSchema = z.strictObject({
  state: z.enum(["starting", "ready", "unreadable"]),
  this: z.strictObject({ id: machineIdSchema, name: z.string() }).nullable(),
  machines: z.array(machineRowSchema),
  start: machineStartSchema,
  last: machineIdSchema.nullable(),
});
export type MachineList = z.infer<typeof machineListSchema>;

export const machinesPairSchema = z.strictObject({
  text: z.string().min(1).max(4096),
});
export const machinesRemoveSchema = z.strictObject({
  machine: machineIdSchema,
});
export const machinesRenameSchema = z.strictObject({
  machine: machineIdSchema,
  alias: z.string().trim().min(1).max(64).nullable(),
});

export type MachinesFailure = {
  ok: false;
  code: "invalid_input" | "forbidden" | "not_found" | "unavailable";
};
export type MachinesReply = { ok: true } | MachinesFailure;

export type MachinePairReason =
  | "invalid_text"
  | "unreachable"
  | "refused"
  | "expired"
  | "closed"
  | "this_computer"
  | "unavailable";
export type MachinePairReply =
  | { ok: true; machine: Id<"mch"> }
  | { ok: false; reason: MachinePairReason };

/** The shell preload's `lophnMachines`. */
export interface LophnMachinesApi {
  /** Rejects with the error code when main refuses. */
  list(): Promise<MachineList>;
  onChanged(listener: (list: MachineList) => void): () => void;
  pair(text: string): Promise<MachinePairReply>;
  remove(machine: Id<"mch">): Promise<MachinesReply>;
  /** null clears the alias and the machine's announced name shows again. */
  rename(machine: Id<"mch">, alias: string | null): Promise<MachinesReply>;
  setStart(start: MachineStart): Promise<MachinesReply>;
}
