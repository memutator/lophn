// Which machine a core call or watch goes to, and what a window bound to another machine may call.
// Any window may name a machine on `shell:core-call`·`shell:core-watch`: another machine goes to that machine's core through
// this computer's core (`machines/call`·`machines/watch`, see `MachineLink`) and nowhere else; no machine or this computer's
// id goes to this computer's core. A window bound to another machine (main binds it when it opens it; the renderer cannot
// claim one) reaches only its machine on those channels, and the rest of what this computer's shell host serves (terminal,
// files, browser, app views, layout…) is refused here, in one place, before any area's handler runs.
// The protected secret window opens from such a window too; its value goes to that machine (wiring/secret-input).
import type { Id } from "../../../../protocol/base/ids.ts";
import type { CoreReply } from "../../../ipc/core-api.ts";
import {
  CORE_CALL_CHANNEL,
  CORE_STATE_GET_CHANNEL,
  CORE_WATCH_CHANNEL,
  type CoreCall,
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
import { SECRET_INPUT_OPEN_CHANNEL } from "../../../ipc/secret-input.ts";
import { WINDOW_CONTROL_CHANNEL } from "../../../ipc/window-controls.ts";

// What a window of another machine may call on this computer's shell besides the core channels: the machine list and
// switching windows, two narrow calls to this computer's core (reading its projects, agents and sessions; clone here), its own window
// buttons, opening a link in the OS browser and opening the protected secret window (the value goes to that machine). Overlay channels, shortcuts and intents
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
  SECRET_INPUT_OPEN_CHANNEL,
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

// A machine's core as a window sees it, built on this computer's core as the person: one route of that machine
// (`machines/call`), a window's Gateway conditions on it (`machines/watch`) and its link state (`machines/list`).
export type MachineLink = {
  call(input: {
    resource: string;
    method: string;
    body: unknown;
  }): Promise<CoreReply>;
  // That window's (webContents id) whole conditions on this machine; `[]` stops it.
  watch(owner: number, conditions: WatchConditions): void;
  current(): {
    state: "starting" | "ready" | "stale";
    confirmedAt: number | null;
  };
};

const FORBIDDEN = {
  ok: false,
  error: {
    code: "forbidden",
    message: "this window views another machine",
  },
} as const;

const OTHER_MACHINE = {
  ok: false,
  error: {
    code: "forbidden",
    message: "this window views another machine than the one named",
  },
} as const;

const INVALID = {
  ok: false,
  error: { code: "invalid_input", message: "not a core call" },
} as const;

const NOT_A_MACHINE_WINDOW = {
  ok: false,
  error: {
    code: "forbidden",
    message: "only a window of another machine calls this",
  },
} as const;

type Binding = { machine: Id<"mch">; link: MachineLink };

export type MachineRoute = {
  // How to reach a named machine and which id is this computer (null until known). wiring/machines gives it.
  attach(machines: {
    link(machine: Id<"mch">): MachineLink;
    self(): Id<"mch"> | null;
  }): void;
  bind(contentsId: number, machine: Id<"mch">, link: MachineLink): void;
  unbind(contentsId: number): void;
  machineOf(contentsId: number): Id<"mch"> | null;
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
  let machines: Parameters<MachineRoute["attach"]>[0] | undefined;

  // The link a core call or watch goes to: undefined is this computer's core, null is refused.
  function target(
    binding: Binding | undefined,
    machine: Id<"mch"> | undefined,
  ): MachineLink | undefined | null {
    if (binding !== undefined) {
      return machine === undefined || machine === binding.machine
        ? binding.link
        : null;
    }
    if (machine === undefined || machine === machines!.self()) return undefined;
    return machines!.link(machine);
  }

  async function call(link: MachineLink, input: CoreCall): Promise<CoreReply> {
    // The machine knows each route's kind from its route table, and bytes travel as base64.
    const { kind, resource, method, body, bytes } = input;
    const reply = await link.call({
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
    attach(given) {
      machines = given;
    },
    bind(contentsId, machine, link) {
      bound.set(contentsId, { machine, link });
    },
    unbind(contentsId) {
      bound.delete(contentsId);
    },
    machineOf: (contentsId) => bound.get(contentsId)?.machine ?? null,
    handle(channel, contentsId, input, local) {
      const binding = bound.get(contentsId);
      if (channel === CORE_CALL_CHANNEL) {
        const parsed = coreCallSchema.safeParse(input);
        if (!parsed.success) return binding === undefined ? local() : INVALID;
        const link = target(binding, parsed.data.machine as Id<"mch">);
        if (link === undefined) return local();
        return link === null ? OTHER_MACHINE : call(link, parsed.data);
      }
      if (channel === CORE_WATCH_CHANNEL) {
        const parsed = coreWatchSchema.safeParse(input);
        if (!parsed.success) return binding === undefined ? local() : undefined;
        const link = target(binding, parsed.data.machine as Id<"mch">);
        if (link === undefined) return local();
        if (link !== null) link.watch(contentsId, parsed.data.conditions);
        return undefined;
      }
      if (binding === undefined) {
        return MACHINE_WINDOW_ONLY.has(channel)
          ? NOT_A_MACHINE_WINDOW
          : local();
      }
      if (channel === CORE_STATE_GET_CHANNEL) return binding.link.current();
      if (channel === MACHINES_THIS_READ_CHANNEL && !thisComputerRead(input)) {
        return FORBIDDEN;
      }
      return MACHINE_WINDOW_CHANNELS.has(channel) ? local() : FORBIDDEN;
    },
    passes: (channel, contentsId) =>
      !bound.has(contentsId) || MACHINE_WINDOW_CHANNELS.has(channel),
  };
}
