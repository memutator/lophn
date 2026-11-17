// Which machine a window views, found by the webContents that sent an IPC, and what a window of another machine may call.
// A window of another machine talks to that machine's core over its connection on the same `shell:core-*` channels; the
// rest of what this computer's shell host serves (terminal, files, browser, app views, secrets, layout…) is refused here,
// in one place, before any area's handler runs. The renderer cannot claim a machine: main binds the window when it opens it.
import type { Id } from "../../../../protocol/base/ids.ts";
import type { CoreReply } from "../../../ipc/core-api.ts";
import {
  CORE_CALL_CHANNEL,
  CORE_STATE_GET_CHANNEL,
  CORE_WATCH_CHANNEL,
  type CoreWatch,
  coreCallSchema,
  coreWatchSchema,
} from "../../../ipc/core.ts";
import {
  MACHINES_CLONE_HERE_CHANNEL,
  MACHINES_LIST_CHANNEL,
  MACHINES_OPEN_CHANNEL,
  MACHINES_THIS_READ_CHANNEL,
  MACHINES_THIS_WINDOW_CHANNEL,
  MACHINES_VISIBLE_CHANNEL,
  THIS_COMPUTER_READS,
} from "../../../ipc/machines.ts";
import { OPEN_EXTERNAL_CHANNEL } from "../../../ipc/open-external.ts";
import { WINDOW_CONTROL_CHANNEL } from "../../../ipc/window-controls.ts";
import type { Connection } from "../../../../remote-client/mod.ts";

// What a window of another machine may call on this computer's shell besides the core channels: the machine list and
// switching windows, two narrow calls to this computer's core (reading its projects, agents and sessions; clone here), its own window
// buttons and opening a link in the OS browser. Overlay channels, shortcuts and intents
// do not pass through here (overlays register on ipcMain themselves; shortcuts and intents are pushed by main).
export const MACHINE_WINDOW_CHANNELS: ReadonlySet<string> = new Set([
  MACHINES_LIST_CHANNEL,
  MACHINES_OPEN_CHANNEL,
  MACHINES_THIS_WINDOW_CHANNEL,
  MACHINES_VISIBLE_CHANNEL,
  MACHINES_THIS_READ_CHANNEL,
  MACHINES_CLONE_HERE_CHANNEL,
  WINDOW_CONTROL_CHANNEL,
  OPEN_EXTERNAL_CHANNEL,
]);

// Channels that reach this computer's core for a window of another machine. A window of this computer has its own core
// channels, so it is refused here; a read outside `THIS_COMPUTER_READS` is refused before the handler runs.
const MACHINE_WINDOW_ONLY: ReadonlySet<string> = new Set([
  MACHINES_THIS_READ_CHANNEL,
  MACHINES_CLONE_HERE_CHANNEL,
]);

function thisComputerRead(input: unknown): boolean {
  const route = (input as { route?: unknown } | null)?.route;
  return (THIS_COMPUTER_READS as readonly unknown[]).includes(route);
}

type WatchConditions = CoreWatch["conditions"];

const FORBIDDEN = {
  ok: false,
  error: {
    code: "forbidden",
    message: "this window views another machine",
  },
} as const;

const NOT_A_MACHINE_WINDOW = {
  ok: false,
  error: {
    code: "forbidden",
    message: "only a window of another machine calls this",
  },
} as const;

const UNAVAILABLE: CoreReply = {
  ok: false,
  error: { code: "unavailable", message: "the machine is not connected" },
};

type Binding = {
  machine: Id<"mch">;
  // The machine's live connection; undefined until the machine list is open (or once the machine left it).
  connection(): Connection | undefined;
  // The last watch the window asked for, so a connection that comes later still gets it.
  conditions: WatchConditions;
};

export type MachineRoute = {
  bind(
    contentsId: number,
    machine: Id<"mch">,
    connection: () => Connection | undefined,
  ): void;
  unbind(contentsId: number): void;
  machineOf(contentsId: number): Id<"mch"> | null;
  watching(contentsId: number): WatchConditions;
  // An `ipcMain.handle` call: this computer's handler (`local`) for a window of this computer, else the rule above.
  handle(
    channel: string,
    contentsId: number,
    input: unknown,
    local: () => unknown,
  ): unknown;
  // An `ipcMain.on` message: whether this computer's listener hears it.
  passes(channel: string, contentsId: number): boolean;
};

export function createMachineRoute(): MachineRoute {
  const bound = new Map<number, Binding>();

  async function call(binding: Binding, input: unknown): Promise<CoreReply> {
    const parsed = coreCallSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: "invalid_input", message: "not a core call" },
      };
    }
    const connection = binding.connection();
    if (connection === undefined || connection.current().state !== "ready") {
      // The window's Retry calls the core too: reconnect now instead of waiting for the backoff.
      connection?.resume();
      return UNAVAILABLE;
    }
    // Over the connection the core knows each route's kind from its route table, and bytes travel as base64.
    const { kind, resource, method, body, bytes } = parsed.data;
    const reply = await connection.call({
      resource,
      method,
      body:
        kind === "upload" && bytes !== undefined
          ? { input: body, base64: Buffer.from(bytes).toString("base64") }
          : body,
    });
    if (kind !== "file" || !reply.ok) return reply;
    const file = reply.value as { content_type: string; base64: string };
    return {
      ok: true,
      value: {
        bytes: new Uint8Array(Buffer.from(file.base64, "base64")),
        contentType: file.content_type,
      },
    };
  }

  return {
    bind(contentsId, machine, connection) {
      bound.set(contentsId, { machine, connection, conditions: [] });
    },
    unbind(contentsId) {
      bound.delete(contentsId);
    },
    machineOf: (contentsId) => bound.get(contentsId)?.machine ?? null,
    watching: (contentsId) => bound.get(contentsId)?.conditions ?? [],
    handle(channel, contentsId, input, local) {
      const binding = bound.get(contentsId);
      if (binding === undefined) {
        return MACHINE_WINDOW_ONLY.has(channel)
          ? NOT_A_MACHINE_WINDOW
          : local();
      }
      if (channel === CORE_CALL_CHANNEL) return call(binding, input);
      if (channel === CORE_WATCH_CHANNEL) {
        const parsed = coreWatchSchema.safeParse(input);
        if (!parsed.success) return undefined;
        binding.conditions = parsed.data.conditions;
        return binding.connection()?.watch(binding.conditions);
      }
      if (channel === CORE_STATE_GET_CHANNEL) {
        const state = binding.connection()?.current();
        return state === undefined
          ? { state: "starting", confirmedAt: null }
          : { state: state.state, confirmedAt: state.confirmedAt };
      }
      if (channel === MACHINES_THIS_READ_CHANNEL && !thisComputerRead(input)) {
        return FORBIDDEN;
      }
      return MACHINE_WINDOW_CHANNELS.has(channel) ? local() : FORBIDDEN;
    },
    passes: (channel, contentsId) =>
      !bound.has(contentsId) || MACHINE_WINDOW_CHANNELS.has(channel),
  };
}
