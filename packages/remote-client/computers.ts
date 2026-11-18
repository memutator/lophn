// The computers this device reaches and one live link to each. React-free so Node tests drive it; the phone's hooks read it
// through `subscribe`/`get`. The list comes from the roster (architecture `remote.md` "내 기기
// 명단"): the saved computers' signing keys are the roots, every computer the view trusts is listed, and one the roster
// removed leaves. This device carries the roster: what one computer sends goes to every other one it connects to. Where the
// list and the roster are saved is the caller's (`load`/`save`); the sample computer (phone dev builds only) is kept in
// memory and never saved.
import type { Id } from "../protocol/base/ids.ts";
import {
  type KeyPair,
  mergeRoster,
  remoteKeyText,
  type RosterEntryBody,
  rosterFresh,
  type RosterInviteText,
  type RosterSnapshot,
  type RosterStatement,
  type RosterView,
  rosterView,
} from "../protocol/remote/client.ts";
import type {
  Announced,
  Connection,
  Endpoint,
  Joined,
  Update,
} from "./connection.ts";
import { ROSTER_JOIN_STATEMENTS_MAX } from "../protocol/remote/roster.ts";
import type { JoinFailure, JoinResult } from "./join.ts";

// A computer this device reaches. `key` (the core's host key) is its identity on the wire. `signing_key` is its roster
// signing key and a root of this device's roster view: learnt from the invite's issuer, a `join` answer (over a channel
// Noise checked against `key`) or a trusted entry of the roster; absent on a computer paired before the roster until its
// first `join` answer. `name` is the alias the person gave it on this device and only the person changes it; `announced` is
// the name the roster gives it (the hello's until the roster lists it). Shown: name ?? announced ?? the address.
// `disputed`: this device's roster view has it out through a removal that is not settled (two computers removed each other,
// one may be stolen). It stays saved so the view can follow the settling, but nothing reaches it: no link, no widget refresh.
export type Computer = Endpoint & {
  signing_key?: string;
  name?: string;
  announced?: string;
  disputed?: true;
};

// `update`: the computer answers but its protocol versions do not meet this app's; `update` on the item says who must update.
// `revoked`: the computer refused this device and the refusal could not be checked as a removal; it is not dialled again
// until the app starts again.
export type ComputerStatus =
  | "connecting"
  | "connected"
  | "offline"
  | "update"
  | "revoked";
export type ComputerPath = "direct" | "relay";

export interface LinkState {
  readonly status: Exclude<ComputerStatus, "revoked">;
  // Who must update while status is `update`; null otherwise.
  readonly update: Update | null;
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
  // Takes this device off the roster through this computer. Absent on the sample computer.
  leave?(): Promise<void>;
  // Sends everything this device holds of the roster. Absent where the link does not carry the roster.
  sendRoster?(roster: RosterSnapshot): void;
  close(): void;
}

export interface ComputerItem {
  readonly key: string;
  // What the screens show: the person's alias, else the roster's name, else its address.
  readonly name: string;
  // The alias the person gave it on this device, and the name the roster gives it; null when there is none.
  readonly alias: string | null;
  readonly announced: string | null;
  // Its machine id once a hello has told it; null before that and for the sample. Job and app text names a computer by it.
  readonly machine: string | null;
  readonly status: ComputerStatus;
  readonly update: Update | null;
  readonly path: ComputerPath | null;
  readonly waiting: number;
  readonly sample: boolean;
}

export interface ComputersState {
  // False until the device key and the saved list are read.
  readonly ready: boolean;
  // What this device calls itself to every computer (its hello name); empty until ready.
  readonly deviceName: string;
  // This device's id in the roster, the same on every computer; null until a computer has let it in.
  readonly device: string | null;
  readonly computers: readonly ComputerItem[];
  readonly current: string | null;
}

export interface SampleComputer<D> {
  readonly key: string;
  readonly name: string;
  readonly link: Link<D>;
}

// This device as the roster already has it: the id to keep, the next rev and the statements about it to hand over.
export type JoinSelf = {
  id: string;
  rev: number;
  statements: RosterStatement[];
};

export interface ComputersDeps<D> {
  load(): Promise<{
    key: KeyPair;
    computers: Computer[];
    roster: RosterSnapshot;
    name: string;
  }>;
  save(saved: { computers: Computer[]; roster: RosterSnapshot }): Promise<void>;
  // Saves the device's name (empty goes back to the default) and returns the one in effect.
  saveName(name: string): Promise<string>;
  // This device left the roster or was taken off it: drops its key for good and returns the new one the next join uses.
  forgetKey(): Promise<KeyPair>;
  // Now in ms: invite statements past their lifetime are not kept.
  now(): number;
  // Opens the link; it connects on its own and keeps retrying until closed. `join` is what the link hands over first on
  // every channel; `onRevoked` is the computer cutting this device off; `onPeer` is the computer saying who it is each time
  // a channel opens; `onRoster` is the computer's roster. `name` is the device's name for that hello.
  open(
    computer: Computer,
    key: KeyPair,
    on: {
      name: string;
      join: () => RosterStatement[];
      onRevoked: (removal?: RosterStatement) => void;
      onPeer: (machine: Announced) => void;
      onRoster: (roster: RosterSnapshot, joined?: Joined) => void;
    },
  ): Link<D>;
  join(
    invite: RosterInviteText,
    key: KeyPair,
    name: string,
    self: JoinSelf | undefined,
  ): Promise<JoinResult>;
  sample?: SampleComputer<D>;
}

export interface Computers<D> {
  get(): ComputersState;
  subscribe(listener: () => void): () => void;
  // Reads the saved list and opens a link to every computer. Later calls return the first one.
  start(): Promise<void>;
  link(key: string): Link<D> | undefined;
  select(key: string): void;
  // Joins the roster with the invite and selects its computer. Returns why when it fails.
  add(invite: RosterInviteText): Promise<JoinFailure | undefined>;
  // Takes this device off the roster through a connected computer (`key`'s link first) and forgets every computer and the
  // device key. The list comes from the roster, so dropping one computer here would come back with the next roster.
  remove(key: string): void;
  // Sets the alias; null or empty clears it and the computer's own name shows again.
  rename(key: string, name: string | null): void;
  // Names this device. Links open again so every computer hears it now.
  setDeviceName(name: string): Promise<void>;
  // The app went to the background or came back.
  pause(): void;
  resume(): void;
}

const STATUS = {
  starting: "connecting",
  ready: "connected",
  stale: "offline",
} as const satisfies Record<
  ReturnType<Connection["current"]>["state"],
  LinkState["status"]
>;

/** A connection's link state, as the phone's links and the core's links to other computers show it. */
export function linkStateOf(
  connection: Connection,
  waiting: number,
): LinkState {
  const update = connection.update();
  return {
    status: update === null ? STATUS[connection.current().state] : "update",
    update,
    path: connection.path(),
    waiting,
  };
}

/** The sample computer is only for phone dev builds started with `EXPO_PUBLIC_LOPHN_SAMPLE=1`. */
export function sampleFor<D>(
  env: { dev: boolean; flag: string | undefined },
  make: () => SampleComputer<D>,
): SampleComputer<D> | undefined {
  return env.dev && env.flag === "1" ? make() : undefined;
}

/** What a computer goes by when it has no alias and no name from the roster or its hello. */
function defaultName(computer: Computer): string {
  return computer.addresses[0] ?? computer.relay ?? computer.key.slice(0, 8);
}

const NO_ROSTER: RosterSnapshot = { statements: [], reach: [] };
// The schema's bound on the reach list of a snapshot.
const REACH_MAX = 256;

/** The statements about the device with `key` that computers signed, newest first: what it hands over in `join`. */
export function ownStatements(
  statements: readonly RosterStatement[],
  key: string,
): RosterStatement[] {
  return statements
    .filter((s) => "by" in s && s.body.type === "entry" && s.body.key === key)
    .sort(
      (a, b) =>
        (b.body as RosterEntryBody).rev - (a.body as RosterEntryBody).rev,
    )
    .slice(0, ROSTER_JOIN_STATEMENTS_MAX - 1);
}

export function createComputers<D>(deps: ComputersDeps<D>): Computers<D> {
  const { sample } = deps;
  let deviceKey: KeyPair | undefined;
  let saved: Computer[] = [];
  let held: RosterSnapshot = NO_ROSTER;
  let view: RosterView = rosterView([], [], null);
  // Computers that refused this device; in memory only, so the next app start tries them again.
  const revoked = new Set<string>();
  let ready = false;
  let starting: Promise<void> | undefined;
  let chosen: string | null = null;
  let sampleName = sample?.name ?? "";
  let deviceName = "";
  const links = new Map<string, { link: Link<D>; stop: () => void }>();
  const listeners = new Set<() => void>();
  let state: ComputersState = {
    ready: false,
    deviceName,
    device: null,
    computers: [],
    current: null,
  };
  // The sample link lives as long as the app, so its listener is never removed.
  sample?.link.subscribe(() => publish());

  const me = () =>
    deviceKey === undefined ? undefined : remoteKeyText(deviceKey.publicKey);
  const roots = () =>
    saved.flatMap((c) => (c.signing_key === undefined ? [] : [c.signing_key]));
  // A saved computer caught in a removal that is not settled (two computers removed each other).
  const disputedIn = (v: RosterView, computer: Computer) =>
    v.removed.some(
      (r) =>
        !r.settled &&
        (r.body.key === computer.key ||
          (computer.signing_key !== undefined &&
            r.body.signing_key === computer.signing_key)),
    );
  const listed = (key: string) =>
    view.devices.find((d) => d.body.kind === "computer" && d.body.key === key)
      ?.body;

  function publish() {
    const computers: ComputerItem[] = [];
    if (sample) {
      computers.push({
        key: sample.key,
        name: sampleName,
        alias: null,
        announced: null,
        machine: null,
        ...sample.link.state(),
        sample: true,
      });
    }
    for (const computer of saved) {
      const live = links.get(computer.key)?.link.state();
      const cut = revoked.has(computer.key) || computer.disputed === true;
      computers.push({
        key: computer.key,
        name: computer.name ?? computer.announced ?? defaultName(computer),
        alias: computer.name ?? null,
        announced: computer.announced ?? null,
        machine: computer.machine ?? null,
        status: cut ? "revoked" : (live?.status ?? "connecting"),
        update: cut ? null : (live?.update ?? null),
        path: cut ? null : (live?.path ?? null),
        waiting: cut ? 0 : (live?.waiting ?? 0),
        sample: false,
      });
    }
    const current = computers.some((one) => one.key === chosen)
      ? chosen
      : (computers[0]?.key ?? null);
    const key = me();
    const device =
      view.devices.find((d) => d.body.key === key)?.body.id ?? null;
    state = { ready, deviceName, device, computers, current };
    for (const listener of [...listeners]) listener();
  }

  const own = () => ownStatements(held.statements, me() ?? "");

  // One link per saved computer that has not refused this device and is not disputed; a link whose computer left the list
  // or became disputed is closed, so nothing is sent to it and none of its requests are answered.
  function sync() {
    const wanted = new Set(
      saved
        .filter((c) => !revoked.has(c.key) && c.disputed !== true)
        .map((c) => c.key),
    );
    for (const key of [...links.keys()]) {
      if (!wanted.has(key)) closeLink(key);
    }
    for (const computer of saved) {
      if (!deviceKey || !wanted.has(computer.key) || links.has(computer.key)) {
        continue;
      }
      const { key } = computer;
      const link = deps.open(computer, deviceKey, {
        name: deviceName,
        join: own,
        onRevoked: (removal) => refused(key, removal),
        onPeer: (machine) => learn(key, machine),
        onRoster: (roster, joined) => received(key, roster, joined),
      });
      links.set(key, { link, stop: link.subscribe(publish) });
    }
    publish();
  }

  function persist() {
    void deps.save({ computers: saved, roster: held });
  }

  // Takes in a roster: merges it into what this device holds and keeps what the view keeps, less invite statements past
  // their lifetime (the phone's clock). Computers the view trusts join the list, ones a settled removal took out leave (a
  // disputed one stays saved, marked, and is not reached), and this device forgets everything when a settled removal takes it
  // out. Returns whether what it holds changed; a change goes to every computer, so one computer's news reaches the next one
  // this device connects to.
  function apply(roster: RosterSnapshot = NO_ROSTER): boolean {
    const merged = mergeRoster(held.statements, roster.statements);
    view = rosterView(merged, roots(), null);
    const key = me();
    // Only a settled removal: a disputed one may be the thief's and resolves when a computer removes it again.
    if (view.removed.some((r) => r.settled && r.body.key === key)) {
      forget();
      return false;
    }
    let changed = false;
    const next: Computer[] = [];
    for (const computer of saved) {
      const gone = view.removed.some(
        (r) =>
          r.settled &&
          (r.body.key === computer.key ||
            (computer.signing_key !== undefined &&
              r.body.signing_key === computer.signing_key)),
      );
      if (gone) {
        changed = true;
        continue;
      }
      const entry = listed(computer.key);
      const learnt = entry && {
        ...computer,
        announced: entry.name,
        machine: (entry.machine as Id<"mch"> | null) ?? computer.machine,
        signing_key: computer.signing_key ?? entry.signing_key ?? undefined,
      };
      if (learnt && JSON.stringify(learnt) !== JSON.stringify(computer)) {
        next.push(learnt);
        changed = true;
      } else {
        next.push(computer);
      }
    }
    const reach = new Map(held.reach.map((r) => [r.device, r]));
    for (const r of roster.reach) reach.set(r.device, r);
    for (const { body } of view.devices) {
      if (body.kind !== "computer" || body.signing_key === null) continue;
      if (next.some((c) => c.key === body.key)) continue;
      // Reach is by device id; a folded id still finds it.
      const ids = [
        body.id,
        ...view.folded.filter((f) => f.to === body.id).map((f) => f.from),
      ];
      const at = ids.map((id) => reach.get(id)).find((r) => r !== undefined);
      // Not listed until the roster says where it is: nothing could dial it.
      if (at === undefined || body.machine === null) continue;
      next.push({
        addresses: at.addresses,
        port: at.port,
        key: body.key,
        ...(at.relay === null ? {} : { relay: at.relay }),
        machine: body.machine as Id<"mch">,
        signing_key: body.signing_key,
        announced: body.name,
      });
      changed = true;
    }
    if (changed) {
      saved = next;
      // The new roots can trust more of what is held.
      view = rosterView(merged, roots(), null);
    }
    const marked = saved.map((computer) => {
      const { disputed: _was, ...rest } = computer;
      return disputedIn(view, computer)
        ? { ...rest, disputed: true as const }
        : rest;
    });
    if (JSON.stringify(marked) !== JSON.stringify(saved)) {
      saved = marked;
      changed = true;
    }
    const statements = rosterFresh(view.keep, deps.now());
    const ids = new Set(
      statements.flatMap((s) => (s.body.type === "entry" ? [s.body.id] : [])),
    );
    const kept: RosterSnapshot = {
      statements,
      reach: [...reach.values()]
        .filter((r) => ids.has(r.device))
        .slice(0, REACH_MAX),
    };
    // Only statements count as news: two computers that list another one at different addresses would otherwise pass this
    // device's reach back and forth for good.
    const moved =
      JSON.stringify(kept.statements) !== JSON.stringify(held.statements);
    const reached = JSON.stringify(kept.reach) !== JSON.stringify(held.reach);
    held = kept;
    if (changed || moved || reached) persist();
    sync();
    if (moved) {
      for (const { link } of links.values()) link.sendRoster?.(held);
    }
    return moved;
  }

  // A computer answered `join` (with `joined`), answered what this device sent, or pushed its roster.
  function received(key: string, roster: RosterSnapshot, joined?: Joined) {
    const computer = saved.find((c) => c.key === key);
    if (!computer) return;
    if (joined && computer.signing_key === undefined) {
      // A computer paired before the roster learns its root here, from the channel Noise checked against its key, and
      // not from an entry in a roster that only claims that key.
      saved = saved.map((c) =>
        c.key === key ? { ...c, signing_key: joined.computer.signing_key } : c,
      );
      persist();
    }
    const moved = apply(roster);
    // After a join the computer hears everything this device holds, also when nothing new came back.
    if (joined && !moved) links.get(key)?.link.sendRoster?.(held);
  }

  // The computer refused this device. Only a removal this device's roots trust makes it forget everything; any other
  // refusal stops this one link.
  function refused(key: string, removal?: RosterStatement) {
    if (removal) apply({ statements: [removal], reach: [] });
    if (!saved.some((c) => c.key === key)) return;
    revoked.add(key);
    sync();
  }

  // This device is off the roster: every computer, what it held of the roster and its key go. The next join makes a new
  // device with a new key; a removed key never joins again.
  function forget() {
    for (const key of [...links.keys()]) closeLink(key);
    saved = [];
    held = NO_ROSTER;
    view = rosterView([], [], null);
    revoked.clear();
    persist();
    deviceKey = undefined;
    void deps.forgetKey().then((key) => {
      deviceKey = key;
      publish();
    });
    publish();
  }

  // A connection met the computer: keep its id, the addresses it gave (which the connection passes on only after checking
  // the id) and, while the roster does not list it, the name from its hello. The alias is the person's and stays.
  function learn(key: string, machine: Announced) {
    const known = saved.find((c) => c.key === key);
    if (!known) return;
    const addresses = machine.addresses ?? known.addresses;
    const announced = listed(key)?.name ?? machine.name;
    if (
      known.machine === machine.id &&
      known.announced === announced &&
      addresses.join("\n") === known.addresses.join("\n")
    )
      return;
    saved = saved.map((c) =>
      c.key === key ? { ...c, machine: machine.id, announced, addresses } : c,
    );
    persist();
    publish();
  }

  function closeLink(key: string) {
    const entry = links.get(key);
    entry?.stop();
    entry?.link.close();
    links.delete(key);
  }

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      starting ??= deps.load().then((loaded) => {
        deviceKey = loaded.key;
        deviceName = loaded.name;
        saved = loaded.computers;
        held = loaded.roster;
        ready = true;
        apply();
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
    async add(invite) {
      // start() has not read the device key yet; nothing could have been dialled.
      if (!deviceKey) return { kind: "unreachable" };
      const key = me();
      const self = view.devices.find((d) => d.body.key === key)?.body;
      const result = await deps.join(
        invite,
        deviceKey,
        deviceName,
        self && { id: self.id, rev: self.rev + 1, statements: own() },
      );
      if (!result.ok) {
        const { failure } = result;
        // A key removed while this device did not hear it: the inviter, chosen by the person, can say so.
        const issuer = invite.issuer.body;
        if (
          failure.kind === "refused" &&
          failure.removal !== undefined &&
          issuer.type === "entry" &&
          issuer.signing_key !== null
        ) {
          const checked = rosterView(
            mergeRoster(held.statements, [invite.issuer, failure.removal]),
            [...roots(), issuer.signing_key],
            null,
          );
          if (checked.removed.some((r) => r.settled && r.body.key === key))
            forget();
        }
        return failure;
      }
      const issuer = result.issuer.body as RosterEntryBody;
      const old = saved.find((c) => c.key === issuer.key);
      const { reach } = invite;
      const computer: Computer = {
        addresses: reach.addresses,
        port: reach.port,
        key: issuer.key,
        ...(reach.relay === null ? {} : { relay: reach.relay }),
        ...(issuer.machine === null
          ? {}
          : { machine: issuer.machine as Id<"mch"> }),
        signing_key: result.joined.computer.signing_key,
        announced: issuer.name,
        ...(old?.name === undefined ? {} : { name: old.name }),
      };
      // A computer joined again: its old link is cut off or holds what came before.
      closeLink(issuer.key);
      revoked.delete(issuer.key);
      saved = [...saved.filter((c) => c !== old), computer];
      chosen = issuer.key;
      persist();
      apply(result.joined.roster);
      return undefined;
    },
    remove(key) {
      if (key === sample?.key) return;
      // The computer that is asked signs the removal and every other computer hears it from there. With none connected,
      // this device still forgets; a computer can take it off the roster later.
      const asked = [key, ...links.keys()].find((one) => {
        const link = links.get(one)?.link;
        return link?.leave && link.state().status === "connected";
      });
      const entry = asked === undefined ? undefined : links.get(asked);
      if (asked !== undefined && entry?.link.leave) {
        links.delete(asked);
        entry.stop();
        void entry.link.leave().finally(() => entry.link.close());
      }
      forget();
    },
    rename(key, name) {
      const alias = name?.trim() || undefined;
      if (key === sample?.key) {
        if (alias !== undefined) sampleName = alias;
        publish();
        return;
      }
      saved = saved.map((c) => {
        if (c.key !== key) return c;
        const { name: _old, ...rest } = c;
        return alias === undefined ? rest : { ...rest, name: alias };
      });
      persist();
      publish();
    },
    async setDeviceName(name) {
      deviceName = await deps.saveName(name);
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
