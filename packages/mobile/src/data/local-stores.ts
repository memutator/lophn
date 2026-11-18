// The phone's app stores, one per computer: every paired computer's apps sync while its link is up, not only the
// computer on screen, and what goes when a computer is no longer paired. Without React, so the data provider (which
// outlives every screen, also the last computer's removal) holds it.
import type { Computers, Link } from "../../../remote-client/mod.ts";
import { carrier } from "../apps/carry/native.ts";
import { appDir, paths } from "../apps/local/folder.ts";
import { nativeDeps } from "../apps/local/native.ts";
import { pruneApp } from "../apps/local/prune.ts";
import { createLocalApps, type LocalApps } from "../apps/local/store.ts";
import { loadComputers } from "../pairing/store.ts";
import type { ComputerData } from "./link.ts";

// One store per computer for the app's life: the sync work of a computer goes on while its screens come and go.
const stores = new Map<string, LocalApps>();
// This phone's id in the roster, the same on every computer: from the computer store `followLocalComputers` follows.
let device: () => string | null = () => null;

export function storeFor(computer: string): LocalApps {
  let store = stores.get(computer);
  if (store === undefined) {
    store = createLocalApps({
      ...nativeDeps,
      computer,
      node: async () => {
        const id = device();
        if (id === null) throw new Error("no computer has let this phone in yet");
        return id;
      },
    });
    stores.set(computer, store);
  }
  return store;
}

/**
 * Connects each paired computer's store to that computer while its link is connected, and passes on its
 * AppSyncChanged: changes made on the phone in a computer's apps reach that computer while another one is on screen.
 * The list cue (installs, release changes) stays with the computer on screen (useLocalApps). Also carries files between
 * the computers (followCarry). Mount once with the computers; returns the stop.
 */
export function followLocalComputers(computers: Computers<ComputerData>): () => void {
  device = () => computers.get().device;
  const stopCarry = followCarry(computers);
  const followed = new Map<string, { link: Link<ComputerData>; off: () => void }>();
  let paired: string | null = null;
  const follow = () => {
    const state = computers.get();
    if (!state.ready) return;
    const keys = state.computers.map((one) => one.key);
    if (keys.join("\n") !== paired) {
      paired = keys.join("\n");
      forget(keys);
    }
    const live = new Set<string>();
    for (const one of state.computers) {
      const link = one.sample ? undefined : computers.link(one.key);
      if (link === undefined) continue;
      live.add(one.key);
      const store = storeFor(one.key);
      if (followed.get(one.key)?.link !== link) {
        followed.get(one.key)?.off();
        const off = link.data.client.subscribe({ types: ["AppSyncChanged"] }, (message) => {
          if (message.kind === "event" && message.event.type === "AppSyncChanged") {
            store.changed(message.event.subject);
          }
        });
        followed.set(one.key, { link, off });
      }
      store.connect(one.status === "connected" ? link.data.core : null);
    }
    for (const [key, one] of followed) {
      if (live.has(key)) continue;
      one.off();
      followed.delete(key);
      stores.get(key)?.connect(null);
    }
  };
  follow();
  const off = computers.subscribe(follow);
  return () => {
    off();
    stopCarry();
    for (const [key, one] of followed) {
      one.off();
      stores.get(key)?.connect(null);
    }
    followed.clear();
  };
}

const CARRY_EVERY_MS = 5 * 60 * 1000;

// The carrier meets each computer while its link is connected: when it comes up, on its StateChanged{carry_files}, and
// every 5 minutes. The app going to the background pauses the links, so carrying stops with them. The computers'
// machine ids are in the saved list, read again when a computer comes or goes or its link changes, and every 5 minutes
// (a machine id learnt from the computer's hello is saved after the change is shown).
function followCarry(computers: Computers<ComputerData>): () => void {
  const carry = carrier();
  let machines = new Map<string, string>();
  let seen: string | null = null;
  const followed = new Map<string, { link: Link<ComputerData>; machine: string; off: () => void }>();
  const apply = () => {
    const state = computers.get();
    const live = new Set<string>();
    for (const one of state.computers) {
      const machine = machines.get(one.key);
      const link = one.sample ? undefined : computers.link(one.key);
      if (machine === undefined || link === undefined) continue;
      live.add(one.key);
      const was = followed.get(one.key);
      if (was?.link !== link || was.machine !== machine) {
        was?.off();
        if (was !== undefined) carry.connect(was.machine, null);
        const off = link.data.client.subscribe({ types: ["StateChanged"] }, (message) => {
          if (
            message.kind === "event" &&
            message.event.type === "StateChanged" &&
            message.event.payload.changes.some((change) => change.name === "carry_files")
          ) {
            carry.changed(machine);
          }
        });
        followed.set(one.key, { link, machine, off });
      }
      carry.connect(machine, one.status === "connected" ? link.data.core : null);
    }
    for (const [key, one] of followed) {
      if (live.has(key)) continue;
      one.off();
      carry.connect(one.machine, null);
      followed.delete(key);
    }
  };
  const read = () =>
    void loadComputers().then((saved) => {
      const known = saved.filter((one) => one.machine !== undefined && one.disputed !== true);
      machines = new Map(known.map((one) => [one.key, one.machine!]));
      carry.roster([...new Set(machines.values())]);
      apply();
    });
  const follow = () => {
    const state = computers.get();
    if (!state.ready) return;
    const now = state.computers.map((one) => `${one.key} ${one.status}`).join("\n");
    if (now !== seen) {
      seen = now;
      read();
    }
    apply();
  };
  follow();
  const off = computers.subscribe(follow);
  const timer = setInterval(() => {
    if (!computers.get().ready) return;
    read();
    carry.all();
  }, CARRY_EVERY_MS);
  return () => {
    off();
    clearInterval(timer);
    for (const one of followed.values()) {
      one.off();
      carry.connect(one.machine, null);
    }
    followed.clear();
  };
}

// The app folders of computers no longer paired go, but for what the computer does not have (prune.ts): a sync app's
// unsent changes and a standalone app's data stay, and come back if the phone pairs with that computer again.
let forgetting: Promise<void> = Promise.resolve();
function forget(paired: readonly string[]) {
  const { files } = nativeDeps;
  forgetting = forgetting
    .then(async () => {
      for (const computer of files.list("")) {
        if (paired.includes(computer)) continue;
        stores.get(computer)?.connect(null);
        stores.delete(computer);
        for (const app of files.list(computer)) {
          // A folder without installed.json is an install that stopped.
          if (!files.exists(paths(computer, app).installed)) files.remove(appDir(computer, app));
          else await pruneApp(nativeDeps, computer, app);
        }
        if (files.list(computer).length === 0) files.remove(computer);
      }
    })
    // One that fails is tried again at the next change of the paired list.
    .catch(() => {});
}
