// The machines this desktop views (other machines' lophn it is paired with as a desktop device) and the start machine.
// shell main holds the connections and the saved list; the renderer reads the whole list and gets it again on every change.
import { z } from "zod";

import { type Id, idSchema } from "../../protocol/base/ids.ts";
import type { CoreReply } from "./core-api.ts";

export const MACHINES_LIST_CHANNEL = "shell:machines-list";
// main → renderer push: the whole list.
export const MACHINES_CHANGED_CHANNEL = "shell:machines-changed";
export const MACHINES_PAIR_CHANNEL = "shell:machines-pair";
export const MACHINES_REMOVE_CHANNEL = "shell:machines-remove";
export const MACHINES_RENAME_CHANNEL = "shell:machines-rename";
export const MACHINES_START_CHANNEL = "shell:machines-start";
// Opens that machine's window or brings it to the front; this machine's id opens a window of this computer, and with a
// session that window opens the session (the popover of a project that is on both machines).
export const MACHINES_OPEN_CHANNEL = "shell:machines-open";
// The machine the calling window views; null in a window of this computer.
export const MACHINES_THIS_WINDOW_CHANNEL = "shell:machines-this-window";
// A window of another machine says which session it shows, for that machine's presence. Only those windows call it.
export const MACHINES_VISIBLE_CHANNEL = "shell:machines-visible";
// A window of another machine reads this computer's projects and sessions, to show which of that machine's projects are
// also here. Only those windows call it, and only these two reads pass.
export const MACHINES_THIS_READ_CHANNEL = "shell:machines-this-read";
// A window of another machine clones one of that machine's projects onto this computer (this computer's `project.clone`).
export const MACHINES_CLONE_HERE_CHANNEL = "shell:machines-clone-here";

export const THIS_COMPUTER_READS = ["project.list", "ListSessions"] as const;
export type ThisComputerRead = (typeof THIS_COMPUTER_READS)[number];

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

export const machinesOpenSchema = z.strictObject({
  machine: machineIdSchema,
  // Only with this computer's id: main refuses a session for another machine.
  session: (idSchema("ses") as unknown as z.ZodType<Id<"ses">>).optional(),
});
export const machinesVisibleSchema = z.strictObject({
  session: idSchema("ses") as unknown as z.ZodType<Id<"ses">>,
  visible: z.boolean(),
});

export const machinesThisReadSchema = z.strictObject({
  route: z.enum(THIS_COMPUTER_READS),
  input: z.unknown(),
});
export const machinesCloneHereSchema = z.strictObject({
  url: z.string().min(1).max(2048),
  identity: z.string().min(1),
  title: z.string().min(1),
});
export type MachinesCloneHere = z.infer<typeof machinesCloneHereSchema>;

export type MachineWindow = { machine: { id: Id<"mch">; name: string } | null };

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
  /**
   * Opens that machine's window or brings it to the front. This machine's id opens a window of this computer; with a session
   * (only for this machine's id) that window opens the session.
   */
  open(machine: Id<"mch">, session?: Id<"ses">): Promise<MachinesReply>;
  /** The machine this window views; null in a window of this computer. */
  thisWindow(): Promise<MachineWindow>;
  /** This computer's core, as the person, for one of `THIS_COMPUTER_READS`. Only a window of another machine may call it. */
  thisRead(route: ThisComputerRead, input: unknown): Promise<CoreReply>;
  /**
   * This computer's `project.clone`. Without a projects folder main asks for a parent folder first; the core's reply comes
   * back as it is (a cancelled picker returns the `projects_folder_unset` failure).
   */
  cloneHere(input: MachinesCloneHere): Promise<CoreReply>;
}
