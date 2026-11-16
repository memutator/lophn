// The machines this desktop views: its device key and saved list, one connection per paired machine, pasted-text pairing,
// and the `shell:machines-*` IPC. Nothing starts until this machine's own id is known (`machine/status` from the local
// core): the saved files carry it and a pairing text from this machine is refused by it.
import { cryptoRandom } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import type { MachineStatus } from "../../../../protocol/machine/mod.ts";
import {
  type Computers,
  type Connection,
  createComputers,
  dialWebSocket,
  type PairFailure,
  pair,
  parsePairingText,
} from "../../../../remote-client/mod.ts";
import {
  MACHINES_CHANGED_CHANNEL,
  MACHINES_LIST_CHANNEL,
  MACHINES_PAIR_CHANNEL,
  MACHINES_REMOVE_CHANNEL,
  MACHINES_RENAME_CHANNEL,
  MACHINES_START_CHANNEL,
  type MachineList,
  type MachinePairReason,
  type MachinePairReply,
  machineStartSchema,
  type MachinesFailure,
  type MachinesReply,
  machinesPairSchema,
  machinesRemoveSchema,
  machinesRenameSchema,
} from "../../../ipc/machines.ts";
import { checkCaller, checkInput, type IpcEvent } from "../ipc-guard.ts";
import { openLink } from "../viewer/links.ts";
import {
  afterRemove,
  machineList,
  startMachine as startRule,
} from "../viewer/list.ts";
import {
  createViewerStore,
  type Saved,
  type ViewerStore,
} from "../viewer/store.ts";
import type { Registered, ShellContext } from "./context.ts";

export type Machines = {
  list(): MachineList;
  subscribe(listener: (list: MachineList) => void): () => void;
  // The live connection to a viewed machine; undefined for this machine, an unknown one, or one that removed this desktop.
  connection(machine: Id<"mch">): Connection | undefined;
  // A window of this machine got focus while connected: it becomes the "last used" start machine.
  markUsed(machine: Id<"mch">): void;
  startMachine(): Id<"mch"> | null;
};

const OS = { darwin: "macos", win32: "windows" } as const;
const os: "linux" | "macos" | "windows" =
  OS[process.platform as keyof typeof OS] ?? "linux";

function pairReason(failure: PairFailure): MachinePairReason {
  if (failure.kind !== "refused") return failure.kind;
  // An expired or already used code.
  return failure.code === "not_found" ? "expired" : "refused";
}

export function register(ctx: ShellContext): Machines & Registered {
  const { ipc, windows } = ctx;
  const registry = ctx.overlays.overlayRegistry();
  const listeners = new Set<(list: MachineList) => void>();
  const connections = new Set<Connection>();
  let state: MachineList["state"] = "starting";
  let self: { id: Id<"mch">; name: string } | null = null;
  let store: ViewerStore | undefined;
  let saved: Saved = {
    computers: [],
    start: { mode: "last" },
    last: null,
    seen: {},
  };
  let computers: Computers<Connection> | undefined;
  let current = build();
  let pushed = JSON.stringify(current);
  let begun = false;
  let stopped = false;

  function build(): MachineList {
    return machineList({
      state,
      self,
      saved,
      items: computers?.get().computers ?? [],
    });
  }

  function publish() {
    current = build();
    const text = JSON.stringify(current);
    // Every `ready` frame of every link lands here; the renderer only hears real changes.
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
    void store
      ?.save(next)
      .catch((error: Error) => ctx.log(`viewer: ${error.message}`));
    publish();
  }

  const keyOf = (machine: Id<"mch">) =>
    saved.computers.find((c) => c.machine === machine)?.key;

  async function begin(): Promise<void> {
    const status = await ctx.coreInternal("memory", "machine", "status", {});
    if (!status.ok) {
      // The next `ready` tries again.
      begun = false;
      return;
    }
    const machine = status.value as MachineStatus;
    self = { id: machine.id as Id<"mch">, name: machine.name };
    const opened = createViewerStore({
      dataRoot: ctx.dataRoot,
      machine: self.id,
      random: cryptoRandom,
      log: ctx.log,
    });
    const read = await opened.open().catch((error: Error) => {
      ctx.log(`viewer: ${error.message}`);
      return { ok: false } as const;
    });
    if (stopped) return;
    if (!read.ok) {
      ctx.log(
        "viewer: shell/viewer files are unreadable; viewing other machines is off",
      );
      state = "unreadable";
      publish();
      return;
    }
    store = opened;
    saved = read.saved;
    const thisMachine = self;
    computers = createComputers<Connection>({
      load: async () => ({
        key: read.key,
        computers: read.saved.computers,
        name: thisMachine.name,
      }),
      save: async (list) => persist({ ...saved, computers: list }),
      // The hello name is this machine's name, which is changed in Settings › Remote "This computer".
      saveName: async () => thisMachine.name,
      open: (computer, key, on) => {
        const link = openLink(computer, key, on, {
          random: cryptoRandom,
          now: Date.now,
          wait: (ms, fn) => {
            const timer = setTimeout(fn, ms);
            return () => clearTimeout(timer);
          },
          newKey: () => crypto.randomUUID(),
          seen: (id, at) =>
            persist({ ...saved, seen: { ...saved.seen, [id]: at } }),
        });
        connections.add(link.data);
        return link;
      },
      pair: (qr, key, name) =>
        pair(qr, {
          key,
          dial: dialWebSocket,
          random: cryptoRandom,
          name,
          capabilities: [],
          device: { kind: "desktop", os },
          self: thisMachine.id,
        }),
    });
    computers.subscribe(publish);
    await computers.start();
    state = "ready";
    publish();
  }

  ctx.relay.ready.push(() => {
    if (begun || stopped) return;
    begun = true;
    void begin();
  });

  const allowed = (event: IpcEvent): boolean => {
    const caller = checkCaller(registry, event);
    return caller.ok && caller.value.origin.host === "desktop";
  };
  const forbidden: MachinesFailure = { ok: false, code: "forbidden" };
  const invalid: MachinesFailure = { ok: false, code: "invalid_input" };
  const unavailable: MachinesFailure = { ok: false, code: "unavailable" };

  ipc.handle(
    MACHINES_LIST_CHANNEL,
    (event: IpcEvent): MachineList | MachinesFailure =>
      allowed(event) ? current : forbidden,
  );

  ipc.handle(
    MACHINES_PAIR_CHANNEL,
    async (
      event: IpcEvent,
      input: unknown,
    ): Promise<MachinePairReply | MachinesFailure> => {
      if (!allowed(event)) return forbidden;
      const parsed = checkInput(machinesPairSchema, input);
      if (!parsed.ok) return invalid;
      if (!computers) return { ok: false, reason: "unavailable" };
      const qr = parsePairingText(parsed.value.text.trim());
      if (!qr) return { ok: false, reason: "invalid_text" };
      const failure = await computers.add(qr);
      if (failure) return { ok: false, reason: pairReason(failure) };
      // `add` selects the entry it saved.
      const added = computers.get().current;
      const machine = saved.computers.find((c) => c.key === added)?.machine;
      return machine
        ? { ok: true, machine }
        : { ok: false, reason: "unavailable" };
    },
  );

  ipc.handle(
    MACHINES_REMOVE_CHANNEL,
    (event: IpcEvent, input: unknown): MachinesReply => {
      if (!allowed(event)) return forbidden;
      const parsed = checkInput(machinesRemoveSchema, input);
      if (!parsed.ok) return invalid;
      if (!computers || !self) return unavailable;
      const { machine } = parsed.value;
      const key = keyOf(machine);
      if (key === undefined) return { ok: false, code: "not_found" };
      // Unpairs first when connected; one that is not reached just leaves the list, as on the phone.
      computers.remove(key);
      persist(afterRemove(saved, machine, self.id));
      return { ok: true };
    },
  );

  ipc.handle(
    MACHINES_RENAME_CHANNEL,
    (event: IpcEvent, input: unknown): MachinesReply => {
      if (!allowed(event)) return forbidden;
      const parsed = checkInput(machinesRenameSchema, input);
      if (!parsed.ok) return invalid;
      if (!computers) return unavailable;
      const key = keyOf(parsed.value.machine);
      if (key === undefined) return { ok: false, code: "not_found" };
      computers.rename(key, parsed.value.alias);
      return { ok: true };
    },
  );

  ipc.handle(
    MACHINES_START_CHANNEL,
    (event: IpcEvent, input: unknown): MachinesReply => {
      if (!allowed(event)) return forbidden;
      const parsed = checkInput(machineStartSchema, input);
      if (!parsed.ok) return invalid;
      if (!computers || !self) return unavailable;
      const start = parsed.value;
      if (
        start.mode === "machine" &&
        start.machine !== self.id &&
        keyOf(start.machine) === undefined
      ) {
        return invalid;
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
    connection(machine) {
      const key = keyOf(machine);
      return key === undefined ? undefined : computers?.link(key)?.data;
    },
    markUsed(machine) {
      if (state !== "ready" || saved.last === machine) return;
      persist({ ...saved, last: machine });
    },
    startMachine: () => startRule(current),
    stop() {
      stopped = true;
      for (const channel of [
        MACHINES_LIST_CHANNEL,
        MACHINES_PAIR_CHANNEL,
        MACHINES_REMOVE_CHANNEL,
        MACHINES_RENAME_CHANNEL,
        MACHINES_START_CHANNEL,
      ]) {
        ipc.removeHandler(channel);
      }
      for (const connection of connections) connection.close();
    },
  };
}
