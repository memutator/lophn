// The other computers in the person's device list that this desktop can view, and the start machine. This computer's core
// holds the connections (`machines/list`); shell main builds the list from it and the renderer reads the whole list and gets
// it again on every change. Adding, removing and renaming devices is Settings › Remote calling `roster/*` on the core.
import { z } from "zod";

import { type Id, idSchema } from "../../protocol/base/ids.ts";
import type { CoreReply } from "./core-api.ts";

export const MACHINES_LIST_CHANNEL = "shell:machines-list";
// main → renderer push: the whole list.
export const MACHINES_CHANGED_CHANNEL = "shell:machines-changed";
export const MACHINES_START_CHANNEL = "shell:machines-start";
// Opens that machine's window or brings it to the front; this machine's id opens a window of this computer, and with a
// session that window opens the session (the popover of a project that is on both machines).
export const MACHINES_OPEN_CHANNEL = "shell:machines-open";
// The machine the calling window views; null in a window of this computer.
export const MACHINES_THIS_WINDOW_CHANNEL = "shell:machines-this-window";
// A window of another machine says which session it shows, for that machine's presence. Only those windows call it.
export const MACHINES_VISIBLE_CHANNEL = "shell:machines-visible";
// A window of another machine reads this computer's projects, agents and sessions, to show which of that machine's projects
// are also here and what sessions they have here. Only those windows call it, and only these reads pass.
export const MACHINES_THIS_READ_CHANNEL = "shell:machines-this-read";
// A window of another machine clones one of that machine's projects onto this computer (this computer's `project.clone`).
export const MACHINES_CLONE_HERE_CHANNEL = "shell:machines-clone-here";

export const THIS_COMPUTER_READS = [
  "project.list",
  "ListAgents",
  "ListSessions",
] as const;
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
  // The name in the device list, the same on every machine.
  name: z.string(),
  // `update`: the machine answers but the remote protocol versions do not meet; `update` says who must update (`client`:
  // lophn on this computer, `host`: lophn on that machine). Null in every other status.
  status: z.enum(["connecting", "connected", "offline", "update"]),
  update: z.enum(["client", "host"]).nullable(),
  path: z.enum(["direct", "relay"]).nullable(),
  last_seen_at: z.string().nullable(),
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

// `starting`: this machine's id or the core's machine list is not known yet. A window whose machine is not in a `ready`
// list views a machine that left the device list.
export const machineListSchema = z.strictObject({
  state: z.enum(["starting", "ready"]),
  this: z.strictObject({ id: machineIdSchema, name: z.string() }).nullable(),
  machines: z.array(machineRowSchema),
  start: machineStartSchema,
  last: machineIdSchema.nullable(),
});
export type MachineList = z.infer<typeof machineListSchema>;

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

/** The shell preload's `lophnMachines`. */
export interface LophnMachinesApi {
  /** Rejects with the error code when main refuses. */
  list(): Promise<MachineList>;
  onChanged(listener: (list: MachineList) => void): () => void;
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
