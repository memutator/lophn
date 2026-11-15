// The paired computers and one live link to each. React-free so Node tests drive it; hooks read it through `subscribe`/`get`.
// Saved computers come from the phone's secure store; the sample computer (dev builds only) is kept in memory and never saved.
import type { PairFailure } from "../pairing/pair.ts";
import type { Computer } from "../pairing/store.ts";
import type { KeyPair, RemotePairing } from "../remote.ts";

export type ComputerStatus = "connecting" | "connected" | "offline" | "revoked";
export type ComputerPath = "direct" | "relay";

export interface LinkState {
  readonly status: Exclude<ComputerStatus, "revoked">;
  readonly path: ComputerPath | null;
  // Things waiting on the person on that computer (its Inbox count).
  readonly waiting: number;
}

// One computer's connection and what is built on it. `data` is what the screens read; the store only needs the rest.
export interface Link<D> {
  readonly data: D;
  state(): LinkState;
  subscribe(listener: () => void): () => void;
  pause(): void;
  resume(): void;
  // Asks the computer to drop this phone's registration. Absent on the sample computer.
  unpair?(): Promise<void>;
  close(): void;
}

export interface ComputerItem {
  readonly key: string;
  readonly name: string;
  readonly status: ComputerStatus;
  readonly path: ComputerPath | null;
  readonly waiting: number;
  readonly sample: boolean;
}

export interface ComputersState {
  // False until the phone key and the saved list are read.
  readonly ready: boolean;
  readonly computers: readonly ComputerItem[];
  readonly current: string | null;
}

export type PairResult =
  | { ok: true; computer: Computer }
  | { ok: false; failure: PairFailure };

export interface SampleComputer<D> {
  readonly key: string;
  readonly name: string;
  readonly link: Link<D>;
}

export interface ComputersDeps<D> {
  load(): Promise<{ phone: KeyPair; computers: Computer[] }>;
  save(computers: Computer[]): Promise<void>;
  // Opens the link; it connects on its own and keeps retrying until closed. `onRevoked` is the computer cutting this phone off.
  open(computer: Computer, phone: KeyPair, onRevoked: () => void): Link<D>;
  pair(qr: RemotePairing, phone: KeyPair): Promise<PairResult>;
  sample?: SampleComputer<D>;
}

export interface Computers<D> {
  get(): ComputersState;
  subscribe(listener: () => void): () => void;
  // Reads the saved list and opens a link to every computer that is not revoked. Later calls return the first one.
  start(): Promise<void>;
  link(key: string): Link<D> | undefined;
  select(key: string): void;
  // Pairs with the QR's computer and selects it. Returns why when it fails.
  add(qr: RemotePairing): Promise<PairFailure | undefined>;
  remove(key: string): void;
  rename(key: string, name: string): void;
  // The app went to the background or came back.
  pause(): void;
  resume(): void;
}

/** The sample computer is only for dev builds started with `EXPO_PUBLIC_LOPHN_SAMPLE=1`. */
export function sampleFor<D>(
  env: { dev: boolean; flag: string | undefined },
  make: () => SampleComputer<D>,
): SampleComputer<D> | undefined {
  return env.dev && env.flag === "1" ? make() : undefined;
}

/** The core does not send its own name, so until the person names it a computer goes by the address it was paired on. */
export function defaultName(computer: Computer): string {
  return computer.addresses[0] ?? computer.relay ?? computer.key.slice(0, 8);
}

export function createComputers<D>(deps: ComputersDeps<D>): Computers<D> {
  const { sample } = deps;
  let phone: KeyPair | undefined;
  let saved: Computer[] = [];
  let ready = false;
  let starting: Promise<void> | undefined;
  let chosen: string | null = null;
  let sampleName = sample?.name ?? "";
  const links = new Map<string, { link: Link<D>; stop: () => void }>();
  const listeners = new Set<() => void>();
  let state: ComputersState = { ready: false, computers: [], current: null };
  // The sample link lives as long as the app, so its listener is never removed.
  sample?.link.subscribe(() => publish());

  function publish() {
    const computers: ComputerItem[] = [];
    if (sample) {
      computers.push({
        key: sample.key,
        name: sampleName,
        ...sample.link.state(),
        sample: true,
      });
    }
    for (const computer of saved) {
      const live = links.get(computer.key)?.link.state();
      computers.push({
        key: computer.key,
        name: computer.name ?? defaultName(computer),
        status: computer.revoked ? "revoked" : (live?.status ?? "connecting"),
        path: computer.revoked ? null : (live?.path ?? null),
        waiting: computer.revoked ? 0 : (live?.waiting ?? 0),
        sample: false,
      });
    }
    const current = computers.some((one) => one.key === chosen)
      ? chosen
      : (computers[0]?.key ?? null);
    state = { ready, computers, current };
    for (const listener of [...listeners]) listener();
  }

  // One link per saved computer that is not revoked; a link whose computer left the list or was revoked is closed.
  function sync() {
    const wanted = new Set(saved.filter((c) => !c.revoked).map((c) => c.key));
    for (const [key, entry] of links) {
      if (wanted.has(key)) continue;
      entry.stop();
      entry.link.close();
      links.delete(key);
    }
    for (const computer of saved) {
      if (!phone || computer.revoked || links.has(computer.key)) continue;
      const link = deps.open(computer, phone, () => revoke(computer.key));
      links.set(computer.key, { link, stop: link.subscribe(publish) });
    }
    publish();
  }

  function update(next: Computer[]) {
    saved = next;
    void deps.save(next);
    sync();
  }

  function revoke(key: string) {
    update(saved.map((c) => (c.key === key ? { ...c, revoked: true } : c)));
  }

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      starting ??= deps.load().then((loaded) => {
        phone = loaded.phone;
        saved = loaded.computers;
        ready = true;
        sync();
      });
      return starting;
    },
    link(key) {
      return key === sample?.key ? sample.link : links.get(key)?.link;
    },
    select(key) {
      chosen = key;
      publish();
    },
    async add(qr) {
      // start() has not read the phone key yet; nothing could have been dialled.
      if (!phone) return { kind: "unreachable" };
      const result = await deps.pair(qr, phone);
      if (!result.ok) return result.failure;
      const computer = result.computer;
      const before = saved.find((c) => c.key === computer.key);
      // Pairing the same computer again gives a new credential: the old link holds the old one.
      const old = links.get(computer.key);
      old?.stop();
      old?.link.close();
      links.delete(computer.key);
      chosen = computer.key;
      update([
        ...saved.filter((c) => c.key !== computer.key),
        before?.name === undefined
          ? computer
          : { ...computer, name: before.name },
      ]);
      return undefined;
    },
    remove(key) {
      if (key === sample?.key) return;
      // A connected computer drops this phone from its list before the link closes. One that is not reached keeps the
      // old registration until the phone pairs with it again, which replaces it.
      const entry = links.get(key);
      if (entry?.link.unpair && entry.link.state().status === "connected") {
        links.delete(key);
        entry.stop();
        void entry.link.unpair().finally(() => entry.link.close());
      }
      update(saved.filter((c) => c.key !== key));
    },
    rename(key, name) {
      const trimmed = name.trim();
      if (trimmed === "") return;
      if (key === sample?.key) {
        sampleName = trimmed;
        publish();
        return;
      }
      update(saved.map((c) => (c.key === key ? { ...c, name: trimmed } : c)));
    },
    pause() {
      for (const { link } of links.values()) link.pause();
      sample?.link.pause();
    },
    resume() {
      for (const { link } of links.values()) link.resume();
      sample?.link.resume();
    },
  };
}
