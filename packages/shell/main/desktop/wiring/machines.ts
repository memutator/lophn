// The other computers this desktop views. This computer's core holds a link to every other computer in
// the device list; shell main reads their state (`machines/list`, again on every `StateChanged{remote_devices}`) and reaches
// one over `machines/call`·`machines/watch` (`MachineLink`, which machine-route picks by the machine a core call or watch names).
// Each subscriber of a machine (a window as `w<webContents id>`, or one inside shell main by its own name) sends its own
// conditions as its `watcher`; this computer's core watches the sum. That machine's Gateway frames come back on this
// computer's Gateway as `MachineFrameReceived` and go, with the machine on them, to the windows watching it alone.
// Any desktop window clones another machine's project onto this computer here (the list's [Clone here]).
import { BrowserWindow, dialog, type WebContents, webContents } from "electron";
import { isAbsolute } from "node:path";

import type { Id } from "../../../../protocol/base/ids.ts";
import type { MachineStatus } from "../../../../protocol/machine/mod.ts";
import {
  CORE_EVENT_CHANNEL,
  type CoreEventMessage,
  type CoreWatch,
} from "../../../ipc/core.ts";
import type { CoreReply } from "../../../ipc/core-api.ts";
import {
  MACHINES_CHANGED_CHANNEL,
  MACHINES_CLONE_HERE_CHANNEL,
  MACHINES_LIST_CHANNEL,
  machinesCloneHereSchema,
  type MachineList,
  type MachinesFailure,
} from "../../../ipc/machines.ts";
import { word } from "../i18n.ts";
import { checkCaller, checkInput, type IpcEvent } from "../ipc-guard.ts";
import { type LinkedMachine, machineList } from "../viewer/list.ts";
import type { MachineLink } from "../viewer/machine-route.ts";
import { changedIds, type Registered, type ShellContext } from "./context.ts";

type Conditions = CoreWatch["conditions"];

export type Machines = {
  list(): MachineList;
  subscribe(listener: (list: MachineList) => void): () => void;
  link(machine: Id<"mch">): MachineLink;
  // A subscriber inside shell main (`app-views`, `notice`…): its whole conditions on that machine, sent as its watcher
  // `owner` (never `w<number>`: that names a window). `[]` stops it. Its frames come on `onFrame`.
  watch(machine: Id<"mch">, owner: string, conditions: Conditions): void;
  // A frame of that machine's Gateway, as a window gets it on `shell:core-event`. `watcher` is set on a `ready` that answered
  // that subscriber's change alone; a `ready` without it is everyone's.
  onFrame(
    listener: (
      machine: Id<"mch">,
      message: CoreEventMessage,
      watcher: string | undefined,
    ) => void,
  ): void;
};

type Frame =
  | { type: "ready" }
  | { type: "event"; event: unknown }
  | {
      type: "closed";
      reason: "slow_consumer" | "credential_revoked" | "shutdown";
    };

function messageOf(machine: Id<"mch">, frame: Frame): CoreEventMessage {
  if (frame.type === "event") {
    return { kind: "event", event: frame.event, machine };
  }
  if (frame.type === "closed") {
    return { kind: "closed", reason: frame.reason, machine };
  }
  return { kind: "ready", machine };
}

// A window's watcher name, and back.
const windowWatcher = (owner: number) => `w${owner}`;
const windowOf = (watcher: string) =>
  /^w\d+$/.test(watcher) ? Number(watcher.slice(1)) : undefined;

export function register(ctx: ShellContext): Machines & Registered {
  const { ipc, windows } = ctx;
  const registry = ctx.overlays.overlayRegistry();
  const listeners = new Set<(list: MachineList) => void>();
  const frames = new Set<Parameters<Machines["onFrame"]>[0]>();
  // Each machine's subscribers (watcher → its last conditions). Sent again when this computer's Gateway (re)connects: the
  // shell capability they were bound to ended with the old Gateway, or the core started again.
  const watching = new Map<Id<"mch">, Map<string, Conditions>>();
  let self: { id: Id<"mch">; name: string } | null = null;
  let knowSelf = () => {};
  const selfKnown = new Promise<void>((resolve) => {
    knowSelf = resolve;
  });
  let rows: LinkedMachine[] = [];
  let listed = false;
  let current = build();
  let pushed = JSON.stringify(current);

  function build(): MachineList {
    return machineList({
      state: self !== null && listed ? "ready" : "starting",
      self,
      machines: rows,
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

  async function read(): Promise<void> {
    if (self === null) {
      const status = await ctx.coreInternal("memory", "machine", "status", {});
      if (!status.ok) return;
      const machine = status.value as MachineStatus;
      self = { id: machine.id as Id<"mch">, name: machine.name };
      knowSelf();
    }
    const listedNow = await ctx.coreInternal("memory", "machines", "list", {});
    if (!listedNow.ok) return;
    rows = (listedNow.value as { machines: LinkedMachine[] }).machines;
    listed = true;
    publish();
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

  // One watch at a time: each is its own request, and core must apply a subscriber's changes in the order they were made
  // (a later one overtaken by an earlier one leaves the old conditions in core).
  let sending: Promise<unknown> = Promise.resolve();
  const send = (
    machine: Id<"mch">,
    watcher: string,
    conditions: Conditions,
  ) => {
    const run = () =>
      ctx.core.machineCall("watch", { machine, watcher, conditions });
    sending = sending.then(run, run);
  };

  function watch(machine: Id<"mch">, watcher: string, conditions: Conditions) {
    const owners = watching.get(machine) ?? new Map<string, Conditions>();
    if (conditions.length === 0) owners.delete(watcher);
    else owners.set(watcher, conditions);
    if (owners.size === 0) watching.delete(machine);
    else watching.set(machine, owners);
    send(machine, watcher, conditions);
  }

  // A closed window of this computer stops watching every machine and releases any remote terminal view lease it alone held.
  ctx.windowHooks.closed.push(({ contentsId }) => {
    ctx.machineRoute.forget(contentsId);
    const watcher = windowWatcher(contentsId);
    for (const [machine, owners] of [...watching]) {
      if (owners.has(watcher)) watch(machine, watcher, []);
    }
  });

  // To the windows watching that machine; a `ready` that answered one window's watch to that window alone.
  function deliver(
    machine: Id<"mch">,
    message: CoreEventMessage,
    to: string | undefined,
  ) {
    for (const watcher of watching.get(machine)?.keys() ?? []) {
      const owner = windowOf(watcher);
      if (owner === undefined || (to !== undefined && to !== watcher)) continue;
      const contents = webContents.fromId(owner);
      if (contents !== undefined && !contents.isDestroyed()) {
        contents.send(CORE_EVENT_CHANNEL, message);
      }
    }
  }

  ctx.relay.conditions.push({ types: ["MachineFrameReceived"] });
  ctx.relay.ready.push(() => {
    refresh();
    for (const [machine, owners] of watching) {
      for (const [watcher, conditions] of owners) {
        send(machine, watcher, conditions);
      }
    }
  });
  ctx.relay.events.push((event) => {
    if (event.type === "MachineFrameReceived") {
      const { machine, frame, watcher } = event.payload as {
        machine: Id<"mch">;
        frame: Frame;
        watcher?: string;
      };
      const message = messageOf(machine, frame);
      const to = frame.type === "ready" ? watcher : undefined;
      deliver(machine, message, to);
      for (const listener of frames) listener(machine, message, to);
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

  // A parent folder for the clone when this computer has no projects folder yet. headless never shows a dialog.
  async function pickParent(sender: WebContents): Promise<string | null> {
    if (ctx.headless.headless) {
      const pick = process.env.LOPHN_SHELL_PICK_FOLDER;
      return pick !== undefined && isAbsolute(pick) ? pick : null;
    }
    const options = {
      title: word("machines.title.clone-parent"),
      properties: ["openDirectory" as const, "createDirectory" as const],
    };
    const parent = BrowserWindow.fromWebContents(sender);
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    const path = result.canceled ? undefined : result.filePaths[0];
    return path !== undefined && isAbsolute(path) ? path : null;
  }

  // This computer's `project.clone` as the person.
  ipc.handle(
    MACHINES_CLONE_HERE_CHANNEL,
    async (event: IpcEvent, input: unknown): Promise<CoreReply> => {
      const failure = (code: string, message: string): CoreReply => ({
        ok: false,
        error: { code, message },
      });
      if (!allowed(event)) return failure("forbidden", "not a desktop window");
      const parsed = checkInput(machinesCloneHereSchema, input);
      if (!parsed.ok) return failure("invalid_input", "not a clone");
      const session = ctx.core.session();
      if (session === null) return failure("unavailable", "core is not ready");
      const clone = (body: object) =>
        session.internal("memory", "projects", "clone", body);
      const first = await clone(parsed.value);
      if (
        first.ok ||
        first.error.details?.["reason"] !== "projects_folder_unset"
      ) {
        return first;
      }
      const parent = await pickParent(event.sender as unknown as WebContents);
      return parent === null ? first : await clone({ ...parsed.value, parent });
    },
  );

  const link = (machine: Id<"mch">): MachineLink => ({
    call: (input) =>
      ctx.core.machineCall("call", {
        machine,
        ...input,
      }) as Promise<CoreReply>,
    watch: (owner, conditions) =>
      watch(machine, windowWatcher(owner), conditions),
  });
  ctx.machineRoute.attach({
    link,
    self: () => self?.id ?? null,
    selfKnown,
  });

  const machines: Machines & Registered = {
    list: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    link,
    watch,
    onFrame(listener) {
      frames.add(listener);
    },
    stop() {
      for (const channel of [
        MACHINES_LIST_CHANNEL,
        MACHINES_CLONE_HERE_CHANNEL,
      ]) {
        ipc.removeHandler(channel);
      }
    },
  };
  ctx.machines = machines;
  return machines;
}
