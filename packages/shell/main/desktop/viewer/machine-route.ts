// Which machine a core call or watch goes to. Any window may name a machine on `shell:core-call`·`shell:core-watch`: another
// machine goes to that machine's core through this computer's core (`machines/call`·`machines/watch`, see `MachineLink`) and
// nowhere else; no machine or this computer's id goes to this computer's core. Every other channel is this computer's own.
import type { Id } from "../../../../protocol/base/ids.ts";
import type { CoreReply } from "../../../ipc/core-api.ts";
import {
  CORE_CALL_CHANNEL,
  CORE_WATCH_CHANNEL,
  type CoreCall,
  type CoreWatch,
  coreCallSchema,
  coreWatchSchema,
} from "../../../ipc/core.ts";

type WatchConditions = CoreWatch["conditions"];

// A machine's core as a window sees it, built on this computer's core as the person: one route of that machine
// (`machines/call`) and a window's Gateway conditions on it (`machines/watch`).
export type MachineLink = {
  call(input: {
    resource: string;
    method: string;
    body: unknown;
  }): Promise<CoreReply>;
  // That window's (webContents id) whole conditions on this machine; `[]` stops it.
  watch(owner: number, conditions: WatchConditions): void;
};

const NOT_ALLOWED = {
  ok: false,
  error: { code: "forbidden", message: "sender is not a desktop window" },
} as const;

// The same answer this computer's core channel gives before its core is ready; the renderer retries it.
const SELF_UNKNOWN = {
  ok: false,
  error: {
    code: "unavailable",
    message: "this computer's id is not known yet",
  },
} as const;

export type MachineRoute = {
  // How to reach a named machine and which id is this computer (null until known; `selfKnown` settles when it is).
  // wiring/machines gives it.
  attach(machines: {
    link(machine: Id<"mch">): MachineLink;
    self(): Id<"mch"> | null;
    selfKnown: Promise<void>;
  }): void;
  // An `ipcMain.handle` call: this computer's handler (`local`), or the named machine's link for a core call or watch.
  // `allowed` is the sender check (a live registered desktop main frame); a call or watch is refused before any link
  // gets it when the sender fails it.
  handle(
    channel: string,
    contentsId: number,
    input: unknown,
    local: () => unknown,
    allowed: () => boolean,
  ): unknown;
};

export function createMachineRoute(): MachineRoute {
  let machines: Parameters<MachineRoute["attach"]>[0] | undefined;

  // The link a core call or watch goes to: undefined is this computer's core.
  function target(machine: Id<"mch"> | undefined): MachineLink | undefined {
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
    handle(channel, contentsId, input, local, allowed) {
      // Until this computer's id is known a named machine may be this computer: a call is answered unavailable and a
      // watch waits for the id (this computer's core channel likewise holds a watch until its core is ready).
      const selfUnknown = (machine: string | undefined) =>
        machine !== undefined && machines!.self() === null;
      if (channel === CORE_CALL_CHANNEL) {
        const parsed = coreCallSchema.safeParse(input);
        if (!parsed.success) return local();
        if (selfUnknown(parsed.data.machine)) return SELF_UNKNOWN;
        const link = target(parsed.data.machine as Id<"mch">);
        if (link === undefined) return local();
        return allowed() ? call(link, parsed.data) : NOT_ALLOWED;
      }
      if (channel === CORE_WATCH_CHANNEL) {
        const parsed = coreWatchSchema.safeParse(input);
        if (!parsed.success) return local();
        const watch = () => {
          const link = target(parsed.data.machine as Id<"mch">);
          if (link === undefined) return void local();
          if (allowed()) link.watch(contentsId, parsed.data.conditions);
        };
        if (selfUnknown(parsed.data.machine)) {
          void machines!.selfKnown.then(watch);
        } else watch();
        return undefined;
      }
      return local();
    },
  };
}
