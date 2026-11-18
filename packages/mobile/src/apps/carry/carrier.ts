// When the phone carries: a computer's link coming up, its StateChanged{carry_files}, every 5 minutes while connected
// (local-stores.ts), and Wi-Fi coming back (native.ts). One meeting at a time over all computers, so two never touch
// the carry folder at once; a cue for a computer already waiting adds nothing.
import type { Remote } from "../local/ports.ts";
import { carryWith, ensureTables, holding, prune } from "./carry.ts";
import type { CarryDeps } from "./ports.ts";

export interface Carrier {
  /** The computer with this machine id is reachable through `remote`, or not (null). */
  connect(machine: string, remote: Remote | null): void;
  /** The machines of every computer in the phone's list. Nothing is carried before the first one. */
  roster(machines: readonly string[]): void;
  /** Its StateChanged{carry_files}. */
  changed(machine: string): void;
  /** Every connected computer again. */
  all(): void;
  /** What the phone holds. */
  holding(): { files: number; bytes: number };
  subscribe(listener: () => void): () => void;
}

export function createCarrier(deps: CarryDeps): Carrier {
  ensureTables(deps.db);
  const connected = new Map<string, Remote>();
  const waiting = new Set<string>();
  const listeners = new Set<() => void>();
  let roster: readonly string[] | null = null;
  let held = holding(deps.db);
  let queue: Promise<void> = Promise.resolve();

  const enqueue = (work: () => Promise<void> | void) => {
    // A meeting that fails (the link dropped) waits for the next cue.
    queue = queue.then(work).catch(() => {});
  };
  const publish = () => {
    held = holding(deps.db);
    for (const listener of listeners) listener();
  };
  const kick = (machine: string) => {
    if (waiting.has(machine)) return;
    waiting.add(machine);
    enqueue(async () => {
      waiting.delete(machine);
      const remote = connected.get(machine);
      if (remote === undefined || roster === null) return;
      try {
        await carryWith(deps, remote, machine, roster);
      } finally {
        prune(deps, roster);
        publish();
      }
    });
  };
  const all = () => {
    for (const machine of connected.keys()) kick(machine);
  };

  return {
    connect(machine, remote) {
      if (remote === null) {
        connected.delete(machine);
        return;
      }
      if (connected.get(machine) === remote) return;
      connected.set(machine, remote);
      kick(machine);
    },
    roster(machines) {
      const first = roster === null;
      roster = [...machines];
      const now = roster;
      enqueue(() => {
        prune(deps, now);
        publish();
      });
      if (first) all();
    },
    changed: kick,
    all,
    holding: () => held,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
