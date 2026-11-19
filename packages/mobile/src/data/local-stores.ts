// The phone's single shared local-app store across all paired computers: every paired computer's apps sync into the
// phone's single copy while its link is up, not only the computer on screen, and computers that leave the roster drop
// cleanly. Without React, so the data provider (which outlives every screen, also the last computer's removal) holds it.
import type { Computers, Link } from "../../../remote-client/mod.ts";
import { carryRosterMachines } from "../apps/carry/carry.ts";
import { carrier } from "../apps/carry/native.ts";
import { nativeDeps } from "../apps/local/native.ts";
import { createLocalApps, type LocalApps } from "../apps/local/store.ts";
import { readRoster } from "../pairing/saved.ts";
import { loadComputers, loadRosterText } from "../pairing/store.ts";
import type { ComputerData } from "./link.ts";

// One shared store for the app's life: serializes per-app SQLite work across all connected computers.
let shared: LocalApps | null = null;
// This phone's id in the roster, the same on every computer: from the computer store `followLocalComputers` follows.
let device: () => string | null = () => null;

export function localStore(): LocalApps {
  if (shared === null) {
    shared = createLocalApps({
      ...nativeDeps,
      node: async () => {
        const id = device();
        if (id === null) throw new Error("no computer has let this phone in yet");
        return id;
      },
    });
  }
  return shared;
}

/**
 * Connects every paired computer to the shared local-app store while its link is connected, and passes on its
 * AppSyncChanged: changes from any paired computer pull into the single DB, and local changes push to any connected
 * computer at the active release. Also carries files between the computers (followCarry). Mount once with the
 * computers; returns the stop.
 */
export function followLocalComputers(computers: Computers<ComputerData>): () => void {
  device = () => computers.get().device;
  const store = localStore();
  const stopCarry = followCarry(computers);
  const followed = new Map<string, { link: Link<ComputerData>; off: () => void }>();
  let paired: string | null = null;
  const follow = () => {
    const state = computers.get();
    if (!state.ready) return;
    const keys = state.computers.map((one) => one.key);
    if (keys.join("\n") !== paired) {
      paired = keys.join("\n");
      store.forget(keys);
    }
    const live = new Set<string>();
    for (const one of state.computers) {
      const link = one.sample ? undefined : computers.link(one.key);
      if (link === undefined) continue;
      live.add(one.key);
      if (followed.get(one.key)?.link !== link) {
        followed.get(one.key)?.off();
        const off = link.data.client.subscribe({ types: ["AppSyncChanged"] }, (message) => {
          if (message.kind === "event" && message.event.type === "AppSyncChanged") {
            store.changed(one.key, message.event.subject);
          }
        });
        followed.set(one.key, { link, off });
      }
      store.connect(one.key, one.status === "connected" ? link.data.core : null);
    }
    for (const [key, one] of followed) {
      if (live.has(key)) continue;
      one.off();
      followed.delete(key);
      store.connect(key, null);
    }
  };
  follow();
  const off = computers.subscribe(follow);
  return () => {
    off();
    stopCarry();
    for (const [key, one] of followed) {
      one.off();
      store.connect(key, null);
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
  let seenRoster: string | null | undefined = undefined;
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
  const read = (rosterText = loadRosterText()) =>
    void loadComputers().then((saved) => {
      const known = saved.filter((one) => one.machine !== undefined && one.disputed !== true);
      machines = new Map(known.map((one) => [one.key, one.machine!]));
      carry.roster(carryRosterMachines(saved, readRoster(rosterText)));
      apply();
    });
  const follow = () => {
    const state = computers.get();
    if (!state.ready) return;
    const now = state.computers.map((one) => `${one.key} ${one.status}`).join("\n");
    const rosterText = loadRosterText();
    if (now !== seen || rosterText !== seenRoster) {
      seen = now;
      seenRoster = rosterText;
      read(rosterText);
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
