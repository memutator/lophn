// The other computers this desktop views and the start machine. This computer's core holds a link to every other computer in
// the device list; shell main reads their state (`machines/list`, again on every `StateChanged{remote_devices}`) and gives a
// window of another machine a `MachineLink` over `machines/call`·`machines/watch`. That machine's Gateway frames come back on
// this computer's Gateway as `MachineFrameReceived` and go to that machine's window alone (machine-windows).
import type { Id } from "../../../../protocol/base/ids.ts";
import type { MachineStatus } from "../../../../protocol/machine/mod.ts";
import type { CoreEventMessage, CoreWatch } from "../../../ipc/core.ts";
import type { CoreReply } from "../../../ipc/core-api.ts";
import {
  MACHINES_CHANGED_CHANNEL,
  MACHINES_LIST_CHANNEL,
  MACHINES_START_CHANNEL,
  type MachineList,
  machineStartSchema,
  type MachinesFailure,
  type MachinesReply,
} from "../../../ipc/machines.ts";
import { checkCaller, checkInput, type IpcEvent } from "../ipc-guard.ts";
import {
  afterRemove,
  type LinkedMachine,
  machineList,
  type Saved,
} from "../viewer/list.ts";
import type { MachineLink } from "../viewer/machine-route.ts";
import { createStartStore, readStart } from "../viewer/start.ts";
import { changedIds, type Registered, type ShellContext } from "./context.ts";

export type Machines = {
  list(): MachineList;
  subscribe(listener: (list: MachineList) => void): () => void;
  link(machine: Id<"mch">): MachineLink;
  // A frame of that machine's Gateway, as the window gets it on `shell:core-event`.
  onFrame(
    listener: (machine: Id<"mch">, message: CoreEventMessage) => void,
  ): void;
  // A window of this machine got focus while connected: it becomes the "last used" start machine.
  markUsed(machine: Id<"mch">): void;
};

type Frame =
  | { type: "ready" }
  | { type: "event"; event: unknown }
  | {
      type: "closed";
      reason: "slow_consumer" | "credential_revoked" | "shutdown";
    };

function messageOf(frame: Frame): CoreEventMessage {
  if (frame.type === "event") return { kind: "event", event: frame.event };
  if (frame.type === "closed") return { kind: "closed", reason: frame.reason };
  return { kind: "ready" };
}

// The window's core state from the link's status. A machine that is not in the list (left the device list) is stale; its
// window shows the removed gate.
function stateOf(
  row: LinkedMachine | undefined,
): ReturnType<MachineLink["current"]> {
  const confirmedAt =
    row?.last_seen_at == null ? null : Date.parse(row.last_seen_at);
  if (row?.status === "connecting") return { state: "starting", confirmedAt };
  if (row?.status === "connected") return { state: "ready", confirmedAt };
  return { state: "stale", confirmedAt };
}

export function register(ctx: ShellContext): Machines & Registered {
  const { ipc, windows } = ctx;
  const registry = ctx.overlays.overlayRegistry();
  const listeners = new Set<(list: MachineList) => void>();
  const frames = new Set<
    (machine: Id<"mch">, message: CoreEventMessage) => void
  >();
  // Each machine's last watch. Sent again when this computer's Gateway (re)connects: a core that started again lost it.
  const watching = new Map<Id<"mch">, CoreWatch["conditions"]>();
  const store = createStartStore(ctx.dataRoot, ctx.log);
  let self: { id: Id<"mch">; name: string } | null = null;
  let rows: LinkedMachine[] = [];
  let listed = false;
  let saved: Saved = { start: { mode: "last" }, last: null, last_name: null };
  let current = build();
  let pushed = JSON.stringify(current);

  function build(): MachineList {
    return machineList({
      state: self !== null && listed ? "ready" : "starting",
      self,
      machines: rows,
      saved,
    });
  }

  function publish() {
    current = build();
    const text = JSON.stringify(current);
    // Every link status change lands here; the renderer only hears real changes.
    if (text === pushed) return;
    pushed = text;
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send(MACHINES_CHANGED_CHANNEL, current);
      }
    }
    for (const listener of [...listeners]) listener(current);
  }

  function persist(next: Saved) {
    saved = next;
    if (self !== null) store.save({ machine: self.id, ...next });
    publish();
  }

  async function read(): Promise<void> {
    if (self === null) {
      const status = await ctx.coreInternal("memory", "machine", "status", {});
      if (!status.ok) return;
      const machine = status.value as MachineStatus;
      self = { id: machine.id as Id<"mch">, name: machine.name };
      const file = await readStart(ctx.dataRoot);
      // A file another machine wrote (a copied data root) is not this machine's start.
      if (file !== null && file.machine === self.id) {
        saved = {
          start: file.start,
          last: file.last,
          last_name: file.last_name,
        };
      }
    }
    const listedNow = await ctx.coreInternal("memory", "machines", "list", {});
    if (!listedNow.ok) return;
    rows = (listedNow.value as { machines: LinkedMachine[] }).machines;
    listed = true;
    const last = rows.find((row) => row.machine === saved.last);
    if (last !== undefined && last.name !== saved.last_name) {
      persist({ ...saved, last_name: last.name });
    } else publish();
  }

  // One read at a time; changes during a read read once more, so an older answer never lands last.
  let reading: Promise<void> | undefined;
  let again = false;
  function refresh(): void {
    if (reading !== undefined) {
      again = true;
      return;
    }
    reading = read()
      .catch((error: Error) => ctx.log(`machines: ${error.message}`))
      .finally(() => {
        reading = undefined;
        if (again) {
          again = false;
          refresh();
        }
      });
  }

  const watch = (machine: Id<"mch">, conditions: CoreWatch["conditions"]) =>
    void ctx.core.machineCall("watch", { machine, conditions });

  ctx.relay.conditions.push({ types: ["MachineFrameReceived"] });
  ctx.relay.ready.push(() => {
    refresh();
    for (const [machine, conditions] of watching) watch(machine, conditions);
  });
  ctx.relay.events.push((event) => {
    if (event.type === "MachineFrameReceived") {
      const { machine, frame } = event.payload as {
        machine: Id<"mch">;
        frame: Frame;
      };
      const message = messageOf(frame);
      for (const listener of frames) listener(machine, message);
      return;
    }
    if (changedIds(event, "remote_devices").length > 0) refresh();
  });

  // `machine/rename` sends no event; its answer carries the name in effect.
  ctx.relay.calls.push((call, reply) => {
    if (!reply.ok || self === null) return;
    if (call.resource === "machine" && call.method === "rename") {
      const name = (reply.value as MachineStatus).name;
      if (name === self.name) return;
      self = { ...self, name };
      publish();
      return;
    }
    if (call.resource === "roster" && call.method === "remove") {
      const device = (reply.value as { id: string }).id;
      const row = rows.find((one) => one.device === device);
      if (row !== undefined) {
        persist(afterRemove(saved, row.machine as Id<"mch">, self.id));
      }
    }
  });

  const allowed = (event: IpcEvent): boolean => {
    const caller = checkCaller(registry, event);
    return caller.ok && caller.value.origin.host === "desktop";
  };

  ipc.handle(
    MACHINES_LIST_CHANNEL,
    (event: IpcEvent): MachineList | MachinesFailure =>
      allowed(event) ? current : { ok: false, code: "forbidden" },
  );

  ipc.handle(
    MACHINES_START_CHANNEL,
    (event: IpcEvent, input: unknown): MachinesReply => {
      if (!allowed(event)) return { ok: false, code: "forbidden" };
      const parsed = checkInput(machineStartSchema, input);
      if (!parsed.ok) return { ok: false, code: "invalid_input" };
      if (self === null || !listed) return { ok: false, code: "unavailable" };
      const start = parsed.value;
      if (
        start.mode === "machine" &&
        start.machine !== self.id &&
        !rows.some((row) => row.machine === start.machine)
      ) {
        return { ok: false, code: "invalid_input" };
      }
      persist({ ...saved, start });
      return { ok: true };
    },
  );

  return {
    list: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    link: (machine) => ({
      call: (input) =>
        ctx.core.machineCall("call", {
          machine,
          ...input,
        }) as Promise<CoreReply>,
      watch(conditions) {
        if (conditions.length === 0) watching.delete(machine);
        else watching.set(machine, conditions);
        watch(machine, conditions);
      },
      current: () => stateOf(rows.find((row) => row.machine === machine)),
    }),
    onFrame(listener) {
      frames.add(listener);
    },
    markUsed(machine) {
      if (self === null || !listed || saved.last === machine) return;
      persist({
        ...saved,
        last: machine,
        last_name: rows.find((row) => row.machine === machine)?.name ?? null,
      });
    },
    stop() {
      for (const channel of [MACHINES_LIST_CHANNEL, MACHINES_START_CHANNEL]) {
        ipc.removeHandler(channel);
      }
    },
  };
}
