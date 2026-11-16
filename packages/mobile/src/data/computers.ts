// The paired computers and one live link to each. React-free so Node tests drive it; hooks read it through `subscribe`/`get`.
// Saved computers come from the phone's secure store; the sample computer (dev builds only) is kept in memory and never saved.
import type { Announced } from "../connection/connection.ts";
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
  // What the screens show: the person's alias, else the name the computer announced, else its address.
  readonly name: string;
  // The alias the person gave it on this phone, and the name the computer last announced; null when there is none.
  readonly alias: string | null;
  readonly announced: string | null;
  readonly status: ComputerStatus;
  readonly path: ComputerPath | null;
  readonly waiting: number;
  readonly sample: boolean;
}

export interface ComputersState {
  // False until the phone key and the saved list are read.
  readonly ready: boolean;
  // What this phone calls itself to every computer (its hello name); empty until ready.
  readonly phoneName: string;
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
  load(): Promise<{ phone: KeyPair; computers: Computer[]; name: string }>;
  save(computers: Computer[]): Promise<void>;
  // Saves the phone's name (empty goes back to the default) and returns the one in effect.
  saveName(name: string): Promise<string>;
  // Opens the link; it connects on its own and keeps retrying until closed. `onRevoked` is the computer cutting this phone
  // off; `onPeer` is the computer saying who it is each time a channel opens. `name` is the phone's name for that hello.
  open(
    computer: Computer,
    phone: KeyPair,
    on: {
      name: string;
      onRevoked: () => void;
      onPeer: (machine: Announced) => void;
    },
  ): Link<D>;
  pair(qr: RemotePairing, phone: KeyPair, name: string): Promise<PairResult>;
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
  // Sets the alias; null or empty clears it and the computer's own name shows again.
  rename(key: string, name: string | null): void;
  // Names this phone. Links open again so every computer hears it now.
  setPhoneName(name: string): Promise<void>;
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

/** What a computer goes by when it has no alias and has not announced a name (one paired by a build that did not hear it). */
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
  let phoneName = "";
  const links = new Map<string, { link: Link<D>; stop: () => void }>();
  const listeners = new Set<() => void>();
  let state: ComputersState = {
    ready: false,
    phoneName,
    computers: [],
    current: null,
  };
  // The sample link lives as long as the app, so its listener is never removed.
  sample?.link.subscribe(() => publish());

  function publish() {
    const computers: ComputerItem[] = [];
    if (sample) {
      computers.push({
        key: sample.key,
        name: sampleName,
        alias: null,
        announced: null,
        ...sample.link.state(),
        sample: true,
      });
    }
    for (const computer of saved) {
      const live = links.get(computer.key)?.link.state();
      computers.push({
        key: computer.key,
        name: computer.name ?? computer.announced ?? defaultName(computer),
        alias: computer.name ?? null,
        announced: computer.announced ?? null,
        status: computer.revoked ? "revoked" : (live?.status ?? "connecting"),
        path: computer.revoked ? null : (live?.path ?? null),
        waiting: computer.revoked ? 0 : (live?.waiting ?? 0),
        sample: false,
      });
    }
    const current = computers.some((one) => one.key === chosen)
      ? chosen
      : (computers[0]?.key ?? null);
    state = { ready, phoneName, computers, current };
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
      const link = deps.open(computer, phone, {
        name: phoneName,
        onRevoked: () => revoke(computer.key),
        onPeer: (machine) => learn(computer.key, machine),
      });
      links.set(computer.key, { link, stop: link.subscribe(publish) });
    }
    publish();
  }

  function update(next: Computer[]) {
    saved = next;
    void deps.save(next);
    sync();
  }

  // A connection met the computer: keep its id (an entry paired before ids has none) and the name it goes by now. The
  // alias is the person's and stays.
  function learn(key: string, machine: Announced) {
    const known = saved.find((c) => c.key === key);
    if (!known) return;
    if (known.machine === machine.id && known.announced === machine.name) return;
    update(
      saved.map((c) =>
        c.key === key ? { ...c, machine: machine.id, announced: machine.name } : c,
      ),
    );
  }

  function closeLink(key: string) {
    const entry = links.get(key);
    entry?.stop();
    entry?.link.close();
    links.delete(key);
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
        phoneName = loaded.name;
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
      const result = await deps.pair(qr, phone, phoneName);
      if (!result.ok) return result.failure;
      const computer = result.computer;
      // The same computer again, by key or by machine id (its key can change with a data root of its own): the old entries
      // fold into the new one, which has the new credential, address and device id. The alias stays.
      const same = saved.filter(
        (c) =>
          c.key === computer.key ||
          (computer.machine !== undefined && c.machine === computer.machine),
      );
      // The old links hold the old credential.
      for (const old of same) closeLink(old.key);
      const alias = same.find((c) => c.name !== undefined)?.name;
      chosen = computer.key;
      update([
        ...saved.filter((c) => !same.includes(c)),
        alias === undefined ? computer : { ...computer, name: alias },
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
      const alias = name?.trim() || undefined;
      if (key === sample?.key) {
        if (alias !== undefined) sampleName = alias;
        publish();
        return;
      }
      update(
        saved.map((c) => {
          if (c.key !== key) return c;
          const { name: _old, ...rest } = c;
          return alias === undefined ? rest : { ...rest, name: alias };
        }),
      );
    },
    async setPhoneName(name) {
      phoneName = await deps.saveName(name);
      // The hello is sent when a channel opens, so a name change needs new channels.
      for (const key of [...links.keys()]) closeLink(key);
      sync();
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
