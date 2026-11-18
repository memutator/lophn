// The client side of a remote connection, shared by the phone app and the desktop shell main. Metro reads this source
// for the phone, so it imports only protocol and base by relative path: no `node:`, React Native or zod.
import type { LophnError, RandomSource } from "../base/mod.ts";
import type { Id } from "../protocol/base/ids.ts";
import { eventConditionSchema } from "../protocol/events/bus.ts";
import {
  connectRemote,
  type KeyPair,
  REMOTE_PATH,
  type RemoteClientChannel,
  type RemoteClientFrame,
  type RemotePeer,
  type RemotePhone,
  type RemoteServerFrame,
  type RemoteTransport,
  type RosterSnapshot,
  type RosterStatement,
  relayPhoneUrl,
  remoteKeyBytes,
  rosterJoinedSchema,
} from "../protocol/remote/client.ts";
import {
  rosterSnapshotSchema,
  rosterStatementSchema,
} from "../protocol/remote/roster.ts";

// Same shape as the desktop renderer's CoreSource (packages/shell/renderer/desktop/connection), so remote screens take either.
export type ConnectionState = {
  state: "starting" | "ready" | "stale";
  confirmedAt: number | null;
};
export type CoreCall = {
  kind?: string;
  resource: string;
  method: string;
  body: unknown;
};
export type CoreReply = {
  ok: boolean;
  value?: unknown;
  error?: { code: string; message: string };
};
export type CoreEventMessage =
  | { kind: "ready" }
  | { kind: "event"; event: unknown }
  | {
      kind: "closed";
      reason: "slow_consumer" | "credential_revoked" | "shutdown";
    };
export type WatchConditions = Extract<
  RemoteClientFrame,
  { type: "watch" }
>["conditions"];

export type CoreSource = {
  subscribe(listener: (state: ConnectionState) => void): () => void;
  current(): ConnectionState;
  call(input: CoreCall): Promise<CoreReply>;
  watch(conditions: WatchConditions): Promise<void>;
  onEvent(listener: (message: CoreEventMessage) => void): () => void;
};

// Calls one connection keeps open at once. The core serves a device's reads from a queue of 8 per caller and holds the
// rest back; a desktop window opening a workspace asks for more than that at once.
const IN_FLIGHT = 8;
// A call with no answer by then is given up with `unavailable` and frees its place, so one lost answer does not hold a
// place for good. Longer than the slowest route (opening a coding session waits up to 55 s) plus a full frame over a
// slow phone link.
const CALL_DEADLINE_MS = 120_000;

// Which way the open channel goes: straight to one of the computer's addresses, or through its relay.
export type ConnectionPath = "direct" | "relay";

export type Connection = CoreSource & {
  // Path of the open channel; null while not connected.
  path(): ConnectionPath | null;
  // Who must update when the last attempt met the computer but the protocol versions did not meet. Kept through later
  // attempts that do not reach it, so the person keeps seeing what to do; cleared when a channel opens.
  update(): Update | null;
  // App went to the background: stop retrying. The open socket is left to the OS.
  pause(): void;
  // App came back: connect now if not connected.
  resume(): void;
  close(): void;
};

// Where a paired computer listens and which one it is. `key` is the core's public key text from the pairing text; `relay`
// is its relay, if it has one. `machine` is the computer's id from its hello: once known, an answer from another machine
// (the same key on a copied data root) is refused before anything is sent to it.
export type Endpoint = {
  addresses: string[];
  port: number;
  key: string;
  relay?: string;
  machine?: Id<"mch">;
};

// What a computer said about itself in its hello: its id, the name it goes by and, only from a connection that checked the
// saved id, the addresses to dial next time.
export type Announced = RemotePeer["machine"];

export type Dial = (url: string) => Promise<RemoteTransport>;

// This device as it meets a computer. `key` is its key pair, which the computer knows it by; `name` is what it calls itself
// in the hello, and the computer lists it by that name; `capabilities` are the `request` kinds it answers (none on desktop);
// `phone` is a phone's screen, sent in every hello.
export type Client = {
  key: KeyPair;
  dial: Dial;
  random: RandomSource;
  name: string;
  capabilities: string[];
  phone?: RemotePhone;
};

type RequestFrame = Extract<RemoteServerFrame, { type: "request" }>;
type ResponseFrame = Extract<RemoteClientFrame, { type: "response" }>;

const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
// How long a resumed channel has to answer the re-sent watch before it counts as dead.
const PROBE_MS = 3000;

// `address` is the direct address that opened; absent on the relay.
export type Opened = {
  channel: RemoteClientChannel;
  path: ConnectionPath;
  address?: string;
};

// Which side must update when the two remote protocol ranges do not meet: `client` is this app, `host` is lophn on the
// computer (named `name` in its hello). From the channel's `conflict` details.
export type Update = "client" | "host";
export type Outdated = { update: Update; name: string };

function outdatedOf(error: LophnError): Outdated | undefined {
  const details = error.details;
  if (error.code !== "conflict" || details === undefined) return undefined;
  const { update, name } = details;
  return (update === "client" || update === "host") && typeof name === "string"
    ? { update, name }
    : undefined;
}

// Dials every address and the relay at once and keeps the first that finishes the handshake; the rest are closed.
// The relay only passes bytes, so the Noise handshake is the same on every path. When none opens and one met the computer
// but the protocol versions did not meet, says who must update instead.
export function openFirst(
  endpoint: Endpoint,
  client: Client,
): Promise<Opened | Outdated | undefined> {
  const remoteStatic = remoteKeyBytes(endpoint.key);
  const urls: { url: string; path: ConnectionPath; address?: string }[] = [
    ...new Set(endpoint.addresses),
  ].map((address) => ({
    url: `ws://${address.includes(":") ? `[${address}]` : address}:${endpoint.port}${REMOTE_PATH}`,
    path: "direct",
    address,
  }));
  if (endpoint.relay) {
    urls.push({
      url: relayPhoneUrl(endpoint.relay, endpoint.key),
      path: "relay",
    });
  }
  if (!remoteStatic || urls.length === 0) return Promise.resolve(undefined);
  const open = async (url: string) => {
    const transport = await client.dial(url).catch(() => undefined);
    if (!transport) return undefined;
    const channel = await connectRemote({
      transport,
      staticKey: client.key,
      remoteStatic,
      capabilities: client.capabilities,
      name: client.name,
      ...(client.phone === undefined ? {} : { phone: client.phone }),
      machine: endpoint.machine,
      random: client.random,
    });
    if (channel.ok) return channel.value;
    outdated ??= outdatedOf(channel.error);
    return undefined;
  };
  let outdated: Outdated | undefined;
  return new Promise((resolve) => {
    let left = urls.length;
    let won = false;
    for (const { url, path, address } of urls) {
      void open(url).then((channel) => {
        left -= 1;
        if (channel && !won) {
          won = true;
          resolve({
            channel,
            path,
            ...(address === undefined ? {} : { address }),
          });
        } else {
          channel?.close();
          if (left === 0 && !won) resolve(outdated);
        }
      });
    }
  });
}

// The computer's own list, with the address this channel opened on kept first: the computer does not know every address
// it is reached at (an emulator's host alias, a forwarded port).
function reachable(announced: string[], opened: string | undefined) {
  return opened === undefined || announced.includes(opened)
    ? announced
    : [opened, ...announced].slice(0, 16);
}

// What the computer said when it let this device in: the device's id and the computer's own id and signing key. It comes
// over a channel Noise checked against the saved host key, so the signing key can be trusted as a root.
export type Joined = {
  device: string;
  computer: { id: string; signing_key: string };
};

export function createConnection(
  deps: Client & {
    endpoint: Endpoint;
    now: () => number;
    // Runs fn after ms; returns a cancel function.
    wait: (ms: number, fn: () => void) => () => void;
    // The computer cut this device off: its `closed` frame, or a refused `join`. `removal` is the removal statement the
    // refusal carried, for the caller to check against its own roots; nothing is trusted here.
    onRevoked: (removal?: RosterStatement) => void;
    // This device's own roster statements, sent as the first frame (`join`) of every channel. Without it no join goes out
    // and the channel is used as soon as it opens (the desktop viewer).
    join?: () => RosterStatement[];
    // The computer's roster: the `join` answer (with `joined`), the answer to `sendRoster`, and every `roster` it pushes.
    onRoster?: (roster: RosterSnapshot, joined?: Joined) => void;
    // Every channel that opens reports who answered, so the store can keep the computer's id, its current name and, when
    // the channel checked the saved id, its current addresses.
    onPeer?: (machine: Announced) => void;
    // The answer to the computer's `request` frame (the phone's location, later more); undefined when it comes too late.
    // `isActive` is false while paused. Without it every request is dropped: the desktop answers no kind.
    answer?: (
      frame: RequestFrame,
      isActive: () => boolean,
    ) => Promise<ResponseFrame | undefined>;
  },
): Connection & {
  // Sends everything this device holds of the roster; the computer's answer goes to `onRoster`. Dropped when not connected.
  sendRoster(roster: RosterSnapshot): void;
} {
  let state: ConnectionState = { state: "starting", confirmedAt: null };
  let channel: RemoteClientChannel | undefined;
  // The open channel's `join` has not been answered yet: nothing else goes out on it.
  let joining = false;
  let path: ConnectionPath | null = null;
  let update: Update | null = null;
  let connecting = false;
  let active = true;
  let stopped = false;
  let failures = 0;
  let cancelRetry: (() => void) | undefined;
  let cancelProbe: (() => void) | undefined;
  // The id this link talks to: the saved one, or the first one it meets. Held here so a computer that has no id saved yet
  // is also checked from its second connection on, without waiting for the store to write the entry.
  let machine = deps.endpoint.machine;
  // The direct addresses the next attempt dials. Replaced by the computer's hello only on a channel that checked the id
  // above, so another machine behind the same key cannot point this device elsewhere.
  let addresses = deps.endpoint.addresses;
  // Last conditions the screen asked for. Sent again on every new channel; `[]` still gets a `ready` back.
  let watching: WatchConditions = [];
  let nextId = 0;
  const pending = new Map<string, (reply: CoreReply) => void>();
  // Ids of the `roster` frames sent and not answered yet.
  const rosters = new Set<string>();
  // Calls past IN_FLIGHT wait here for an answer to free a place.
  const queued: { input: CoreCall; resolve: (reply: CoreReply) => void }[] = [];
  const stateListeners = new Set<(state: ConnectionState) => void>();
  const eventListeners = new Set<(message: CoreEventMessage) => void>();

  function setState(next: ConnectionState) {
    state = next;
    for (const listener of stateListeners) listener(next);
  }

  function emit(message: CoreEventMessage) {
    for (const listener of eventListeners) listener(message);
  }

  function retry() {
    if (!active || stopped || cancelRetry) return;
    const delay = Math.min(BACKOFF_MIN_MS * 2 ** failures, BACKOFF_MAX_MS);
    failures += 1;
    cancelRetry = deps.wait(delay, () => {
      cancelRetry = undefined;
      void connect();
    });
  }

  async function connect() {
    if (connecting || channel || !active || stopped) return;
    connecting = true;
    const checked = machine !== undefined;
    const opened = await openFirst(
      { ...deps.endpoint, machine, addresses },
      deps,
    );
    connecting = false;
    if (!opened || !("channel" in opened)) {
      if (opened) update = opened.update;
      setState({ state: "stale", confirmedAt: state.confirmedAt });
      return retry();
    }
    if (stopped) return opened.channel.close();
    update = null;
    const { addresses: announced, ...peer } = opened.channel.peer.machine;
    machine = peer.id;
    if (checked && announced !== undefined) {
      addresses = reachable(announced, opened.address);
      deps.onPeer?.({ ...peer, addresses });
    } else {
      deps.onPeer?.(peer);
    }
    channel = opened.channel;
    path = opened.path;
    channel.onClose(() => dropped(opened.channel));
    channel.onFrame(received);
    if (deps.join) {
      joining = true;
      channel.send({ type: "join", id: "join", statements: deps.join() });
    } else {
      channel.send({ type: "watch", conditions: watching });
    }
  }

  function joined(frame: Extract<RemoteServerFrame, { type: "result" }>) {
    const current = channel;
    if (!current) return;
    if (!frame.ok) {
      if (frame.error.code === "unauthorized") {
        stopped = true;
        const removal = rosterStatementSchema.safeParse(
          frame.error.details?.removal,
        );
        deps.onRevoked(removal.success ? removal.data : undefined);
      }
      // Anything else is tried again on a new channel.
      current.close();
      return;
    }
    const value = rosterJoinedSchema.safeParse(frame.value);
    if (!value.success) return current.close();
    joining = false;
    const { roster, ...rest } = value.data;
    deps.onRoster?.(roster, rest);
    current.send({ type: "watch", conditions: watching });
  }

  function lose() {
    channel = undefined;
    joining = false;
    rosters.clear();
    path = null;
    cancelProbe?.();
    cancelProbe = undefined;
    for (const [id, resolve] of pending) {
      pending.delete(id);
      resolve({
        ok: false,
        error: { code: "unavailable", message: "connection closed" },
      });
    }
    for (const { resolve } of queued.splice(0)) {
      resolve({
        ok: false,
        error: { code: "unavailable", message: "connection closed" },
      });
    }
    if (!stopped) setState({ state: "stale", confirmedAt: state.confirmedAt });
  }

  function dropped(closed: RemoteClientChannel) {
    if (channel !== closed) return;
    lose();
    retry();
  }

  // After the background the socket may have died without a close event. The core answers a watch with `ready`;
  // if that does not come in time, drop the channel and connect again now instead of waiting for a backoff.
  function probe(current: RemoteClientChannel) {
    if (joining) return;
    current.send({ type: "watch", conditions: watching });
    cancelProbe = deps.wait(PROBE_MS, () => {
      cancelProbe = undefined;
      if (channel !== current) return;
      lose();
      current.close();
      void connect();
    });
  }

  function send(input: CoreCall): Promise<CoreReply> {
    if (!channel || joining) {
      return Promise.resolve({
        ok: false,
        error: { code: "unavailable", message: "not connected" },
      });
    }
    const id = `c${++nextId}`;
    const sent = channel.send({
      type: "call",
      id,
      resource: input.resource,
      method: input.method,
      body: input.body,
    });
    if (!sent.ok) return Promise.resolve({ ok: false, error: sent.error });
    return new Promise((resolve) => {
      const cancel = deps.wait(CALL_DEADLINE_MS, () =>
        answered(id, {
          ok: false,
          error: { code: "unavailable", message: "no answer in time" },
        }),
      );
      pending.set(id, (reply) => {
        cancel();
        resolve(reply);
      });
    });
  }

  // Settles a call that is still open and lets the next queued call take its place.
  function answered(id: string, reply: CoreReply) {
    const resolve = pending.get(id);
    if (!resolve) return;
    pending.delete(id);
    resolve(reply);
    const next = queued.shift();
    if (next) void send(next.input).then(next.resolve);
  }

  function received(frame: RemoteServerFrame) {
    if (frame.type === "result" && frame.id === "join" && joining) {
      joined(frame);
    } else if (frame.type === "result" && rosters.delete(frame.id)) {
      const roster = frame.ok
        ? rosterSnapshotSchema.safeParse(frame.value)
        : undefined;
      if (roster?.success) deps.onRoster?.(roster.data);
    } else if (frame.type === "roster") {
      deps.onRoster?.(frame.roster);
    } else if (frame.type === "result") {
      answered(
        frame.id,
        frame.ok
          ? { ok: true, value: frame.value }
          : { ok: false, error: frame.error },
      );
    } else if (frame.type === "ready") {
      cancelProbe?.();
      cancelProbe = undefined;
      failures = 0;
      setState({ state: "ready", confirmedAt: deps.now() });
      emit({ kind: "ready" });
    } else if (frame.type === "request") {
      if (!deps.answer) return;
      const from = channel;
      void deps
        .answer(frame, () => active)
        .then((response) => {
          if (response && channel === from) from?.send(response);
        });
    } else if (frame.type === "event") {
      emit({ kind: "event", event: frame.event });
    } else if (frame.type === "closed") {
      if (frame.reason === "credential_revoked") {
        stopped = true;
        deps.onRevoked();
      }
      emit({ kind: "closed", reason: frame.reason });
    }
  }

  void connect();

  return {
    subscribe(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    current: () => state,
    path: () => path,
    update: () => update,
    call(input) {
      if (pending.size < IN_FLIGHT) return send(input);
      return new Promise((resolve) => queued.push({ input, resolve }));
    },
    watch(conditions) {
      // The core closes the channel on a condition it cannot parse (a session id that is not one), and every new channel
      // sends the last watch again, so one bad condition kept the device offline for good. It is left out instead.
      watching = conditions.filter(
        (one) => eventConditionSchema.safeParse(one).success,
      );
      if (!joining) channel?.send({ type: "watch", conditions: watching });
      return Promise.resolve();
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    pause() {
      active = false;
      cancelRetry?.();
      cancelRetry = undefined;
    },
    resume() {
      active = true;
      failures = 0;
      cancelRetry?.();
      cancelRetry = undefined;
      if (channel && !cancelProbe) probe(channel);
      else void connect();
    },
    sendRoster(roster) {
      if (!channel || joining) return;
      const id = `r${++nextId}`;
      if (channel.send({ type: "roster", id, roster }).ok) rosters.add(id);
    },
    close() {
      stopped = true;
      cancelRetry?.();
      cancelRetry = undefined;
      channel?.close();
    },
  };
}
