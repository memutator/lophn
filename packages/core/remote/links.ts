// 이 컴퓨터 core가 명단의 다른 컴퓨터마다 드는 연결(link). 붙는 쪽 engine은 폰과 같은 `@lophn/remote-client`이고, 받는 쪽은 그
// 컴퓨터의 host가 폰과 같이 맡는다: 이 컴퓨터는 거기서 `device:<이 컴퓨터 id>`인 기기다. 컴퓨터 둘은 서로에게 따로 link를 든다
// (한쪽만 닿는 network에서도 닿는 쪽 link 하나로 명단이 오간다). link로 명단을 주고받고, 이 기계의 화면이 부른
// `machines/call`·`machines/watch`를 넘긴다. 그 기계의 Gateway frame은 이 컴퓨터의 bus에 `MachineFrameReceived`로 싣는다.
// link마다 화면의 조건에 `StateChanged`를 더해 걸어, 그 컴퓨터가 든 옮기는 file이 바뀐 것(`carry_files`)을 나르기(carry.ts)에 알린다.
import { WebSocket } from "ws";
import {
  type Clock,
  canonicalize,
  err,
  type LophnError,
  type Logger,
  ok,
  type RandomSource,
  type Result,
} from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import {
  type BusEvent,
  type EventCondition,
  publishStateChanged,
} from "../../protocol/events/mod.ts";
import {
  type KeyPair,
  ROSTER_JOIN_STATEMENTS_MAX,
  type RemoteTransport,
  type RosterEntryBody,
  type RosterSnapshot,
  type RosterStatement,
} from "../../protocol/remote/mod.ts";
import { NOISE_MAX_MESSAGE_BYTES } from "../../protocol/remote/noise.ts";
import {
  type Connection,
  createConnection,
  type Dial,
  type Endpoint,
  linkStateOf,
} from "../../remote-client/mod.ts";
import type { Roster } from "./roster.ts";

// 조용히 끊긴 socket(잠든 노트북, 바뀐 network)을 알아채려 ping하고, 이만큼 아무것도 오지 않으면 끊는다. 그래야 link가 다시 붙는다.
const PING_MS = 20_000;
const IDLE_MS = 60_000;

// 실제 WebSocket. message 하나는 Noise message 하나다.
export const dialNodeWebSocket: Dial = (url) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
      maxPayload: NOISE_MAX_MESSAGE_BYTES,
      perMessageDeflate: false,
      handshakeTimeout: 10_000,
    });
    ws.binaryType = "arraybuffer";
    const handlers = { message: (_: Uint8Array) => {}, close: () => {} };
    let idle: NodeJS.Timeout | undefined;
    let ping: NodeJS.Timeout | undefined;
    const alive = () => {
      clearTimeout(idle);
      idle = setTimeout(() => ws.terminate(), IDLE_MS).unref();
    };
    ws.on("error", () => reject(new Error(`cannot connect to ${url}`)));
    ws.on("message", (payload, isBinary) => {
      alive();
      if (isBinary) handlers.message(new Uint8Array(payload as ArrayBuffer));
    });
    ws.on("pong", alive);
    ws.on("close", () => {
      clearTimeout(idle);
      clearInterval(ping);
      handlers.close();
    });
    ws.on("open", () => {
      alive();
      ping = setInterval(() => ws.ping(), PING_MS).unref();
      resolve({
        send: (bytes) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(bytes);
        },
        close: () => ws.close(),
        onMessage: (fn) => {
          handlers.message = fn;
        },
        onClose: (fn) => {
          handlers.close = fn;
        },
      } satisfies RemoteTransport);
    });
  });

export type LinkStatus = "connecting" | "connected" | "offline" | "update";

export type LinkedMachine = {
  machine: Id<"mch">;
  device: string;
  name: string;
  status: LinkStatus;
  update: "client" | "host" | null;
  path: "direct" | "relay" | null;
  last_seen_at: string | null;
};

export type LinksDeps = {
  roster: Pick<Roster, "view" | "self" | "snapshot" | "receive">;
  // hello에 싣는 이 기계의 이름.
  name(): string;
  dial: Dial;
  random: RandomSource;
  clock: Clock;
  // ms 뒤에 fn을 부른다. 취소 함수를 돌려준다.
  wait(ms: number, fn: () => void): () => void;
  publish(event: BusEvent): void;
  logger: Logger;
  // 그 컴퓨터와의 link가 붙었다(붙을 때마다).
  onPeerReady(machine: Id<"mch">): void;
  // 그 컴퓨터가 든 옮기는 file이 바뀌었다(그 컴퓨터의 `StateChanged{carry_files}`).
  onPeerCarry(machine: Id<"mch">): void;
};

// 나르기가 link마다 화면의 조건에 더해 거는 조건. 화면이 원하지 않은 `StateChanged`는 bus에 싣지 않는다.
const CARRY_CONDITION: EventCondition = { types: ["StateChanged"] };

// 화면의 조건이 `StateChanged`(session 없는 event)에 맞는가.
const screenWantsStateChanged = (conditions: EventCondition[] | undefined) =>
  conditions?.some(
    (each) =>
      each.session === undefined &&
      (each.types === undefined || each.types.includes("StateChanged")),
  ) ?? false;

type Link = {
  body: RosterEntryBody;
  // 연 endpoint의 canonical 글. 붙지 않은 link는 주소가 바뀌면 새로 연다.
  endpoint: string;
  connection: Connection & { sendRoster(roster: RosterSnapshot): void };
  // 그 컴퓨터가 이 컴퓨터를 거절했거나(`join`, credential_revoked) 서명 key가 명단과 달랐다. 연결은 멈췄고 명단이 바뀌면 다시 연다.
  refused: boolean;
  // 마지막으로 낸 상태. 바뀔 때만 StateChanged를 낸다.
  shown: string;
};

export type Links = ReturnType<typeof createLinks>;

export function createLinks(deps: LinksDeps) {
  const links = new Map<string, Link>();
  // 기계마다 하나인 화면의 watch 조건(기기 id로). link를 새로 열어도 다시 건다.
  const watching = new Map<string, EventCondition[]>();
  const conditionsOf = (device: string) => [
    ...(watching.get(device) ?? []),
    CARRY_CONDITION,
  ];
  // 기기 id → 마지막으로 붙었거나 끊긴 때. core가 사는 동안만 든다.
  const seen = new Map<string, string>();
  let key: KeyPair | undefined;

  function changed(device: string) {
    publishStateChanged(
      { publish: (event) => deps.publish(event as BusEvent) },
      deps.clock.now(),
      [{ name: "remote_devices", id: device }],
    );
  }

  function statusOf(link: Link) {
    if (link.refused) {
      return { status: "offline" as const, update: null, path: null };
    }
    const { status, update, path } = linkStateOf(link.connection, 0);
    return { status, update, path };
  }

  function report(link: Link) {
    const state = statusOf(link);
    const text = canonicalize(state);
    if (text === link.shown) return;
    const was = JSON.parse(link.shown) as { status: LinkStatus };
    if ((was.status === "connected") !== (state.status === "connected")) {
      seen.set(link.body.id, deps.clock.now());
    }
    link.shown = text;
    changed(link.body.id);
    if (state.status === "connected" && was.status !== "connected") {
      deps.onPeerReady(link.body.machine as Id<"mch">);
    }
  }

  // 붙을 때 내미는 이 컴퓨터 key의 statement: 초대 서명 statement(아직 받아들여지지 않았을 때 그 컴퓨터가 확인한다) 먼저,
  // 그다음 컴퓨터들이 서명한 항목을 새 rev부터.
  function own(hostKey: string): RosterStatement[] {
    const mine = deps.roster
      .snapshot()
      .statements.filter(
        (s) => s.body.type === "entry" && s.body.key === hostKey,
      );
    const rev = (s: RosterStatement) => (s.body as RosterEntryBody).rev;
    return [
      ...mine.filter((s) => !("by" in s)),
      ...mine.filter((s) => "by" in s).sort((a, b) => rev(b) - rev(a)),
    ].slice(0, ROSTER_JOIN_STATEMENTS_MAX);
  }

  function receive(snapshot: RosterSnapshot, after?: () => void) {
    void deps.roster.receive(snapshot).then((done) => {
      if (!done.ok) {
        deps.logger.error({
          component: "remote",
          event: "link_roster_not_saved",
          fields: { message: done.error.message },
        });
      } else after?.();
    });
  }

  // hello의 주소를 그 컴퓨터의 reach로 둔다. port와 relay는 명단의 것 그대로다.
  function learn(device: string, addresses: string[]) {
    const known = deps.roster
      .snapshot()
      .reach.find((each) => each.device === device);
    if (
      known === undefined ||
      canonicalize(known.addresses) === canonicalize(addresses)
    ) {
      return;
    }
    receive({ statements: [], reach: [{ ...known, addresses }] });
  }

  function endpointOf(body: RosterEntryBody): Endpoint {
    const reach = deps.roster
      .snapshot()
      .reach.find((each) => each.device === body.id);
    return {
      addresses: reach?.addresses ?? [],
      port: reach?.port ?? 0,
      key: body.key,
      ...(reach?.relay ? { relay: reach.relay } : {}),
      machine: body.machine as Id<"mch">,
    };
  }

  function open(body: RosterEntryBody, endpoint: Endpoint, hostKey: string) {
    const signingKey = body.signing_key;
    const connection = createConnection({
      endpoint,
      key: key!,
      dial: deps.dial,
      random: deps.random,
      name: deps.name(),
      capabilities: [],
      now: () => deps.clock.nowMs(),
      wait: deps.wait,
      join: () => own(hostKey),
      onRoster(roster, joined) {
        if (
          joined !== undefined &&
          joined.computer.signing_key !== signingKey
        ) {
          deps.logger.warn({
            component: "remote",
            event: "link_signing_key_mismatch",
            message:
              "the computer answered with a signing key the roster does not hold for it; the link was closed",
            fields: { device: body.id },
          });
          link.refused = true;
          connection.close();
          report(link);
          return;
        }
        // `join` 뒤에는 이 컴퓨터가 든 것 전부를 보낸다. 그 컴퓨터가 모르던 statement(초대 서명 statement 포함)가 간다.
        receive(
          roster,
          joined === undefined
            ? undefined
            : () => connection.sendRoster(deps.roster.snapshot()),
        );
      },
      onRevoked(removal) {
        link.refused = true;
        report(link);
        // 빼기는 이 컴퓨터의 root로 확인한다. 맞으면 명단에서 이 컴퓨터가 빠져 key를 버린다(wiring).
        if (removal !== undefined)
          receive({ statements: [removal], reach: [] });
      },
      onPeer(peer) {
        if (peer.addresses !== undefined) learn(body.id, peer.addresses);
      },
    });
    const link: Link = {
      body,
      endpoint: canonicalize(endpoint),
      connection,
      refused: false,
      shown: canonicalize({ status: "connecting", update: null, path: null }),
    };
    void connection.watch(conditionsOf(body.id));
    connection.subscribe(() => report(link));
    connection.onEvent((message) => {
      const machine = body.machine as Id<"mch">;
      if (message.kind === "event") {
        const event = message.event as {
          type?: unknown;
          payload?: { changes?: { name: string }[] };
        };
        if (event.type === "StateChanged") {
          if (
            event.payload?.changes?.some((each) => each.name === "carry_files")
          ) {
            deps.onPeerCarry(machine);
          }
          if (!screenWantsStateChanged(watching.get(body.id))) return;
        }
      }
      deps.publish({
        type: "MachineFrameReceived",
        subject: `machine:${machine}`,
        at: deps.clock.now(),
        payload: {
          machine,
          frame:
            message.kind === "event"
              ? { type: "event", event: message.event as never }
              : message.kind === "closed"
                ? { type: "closed", reason: message.reason }
                : { type: "ready" },
        },
      } as BusEvent);
    });
    links.set(body.id, link);
    changed(body.id);
  }

  function drop(id: string) {
    const link = links.get(id);
    if (link === undefined) return;
    links.delete(id);
    link.connection.close();
    changed(id);
  }

  // 명단의 다른 컴퓨터(이 컴퓨터를 뺀 kind computer)와 link를 맞춘다. `next`가 없으면(remote가 꺼짐) 모두 닫는다.
  // key가 바뀌면(명단과 key를 버리고 새로 섰다) 모두 새로 연다.
  function sync(next: KeyPair | undefined) {
    if (next !== key) for (const id of [...links.keys()]) drop(id);
    key = next;
    const self = deps.roster.self();
    if (key === undefined || self === undefined) {
      for (const id of [...links.keys()]) drop(id);
      return;
    }
    const wanted = new Map(
      deps.roster
        .view()
        .devices.filter(
          (each) => each.body.kind === "computer" && each.body.id !== self.id,
        )
        .map((each) => [each.body.id, each.body]),
    );
    for (const id of [...links.keys()]) if (!wanted.has(id)) drop(id);
    for (const [id, body] of wanted) {
      const endpoint = endpointOf(body);
      const link = links.get(id);
      if (
        link !== undefined &&
        link.body.key === body.key &&
        link.body.signing_key === body.signing_key &&
        !link.refused &&
        (link.endpoint === canonicalize(endpoint) ||
          link.connection.current().state === "ready")
      ) {
        link.body = body;
        continue;
      }
      if (link !== undefined) {
        links.delete(id);
        link.connection.close();
      }
      open(body, endpoint, self.hostKey);
    }
  }

  // 명단의 다른 컴퓨터. 이 기계의 화면은 기계 id로 고른다.
  function computer(machine: string) {
    const self = deps.roster.self()?.id;
    return deps.roster
      .view()
      .devices.find(
        (each) =>
          each.body.kind === "computer" &&
          each.body.machine === machine &&
          each.body.id !== self,
      )?.body;
  }

  // 이 컴퓨터 자신을 고른 call은 link가 없다: 이 core의 route를 바로 부르면 된다.
  function notFound(machine: string): Result<never> {
    const self = deps.roster.self()?.id;
    const mine = deps.roster.view().devices.find((d) => d.body.id === self);
    return mine?.body.machine === machine
      ? err({
          code: "invalid_input",
          message:
            "this machine is this computer; call its routes directly, not through machines/call",
        })
      : err({ code: "not_found", message: "machine not found in the roster" });
  }

  return {
    sync,

    // 이 컴퓨터가 든 명단이 바뀌었다. 붙은 link마다 든 것 전부를 보낸다.
    pushRoster(snapshot: RosterSnapshot) {
      for (const link of links.values()) link.connection.sendRoster(snapshot);
    },

    list(): LinkedMachine[] {
      const self = deps.roster.self()?.id;
      return deps.roster
        .view()
        .devices.filter(
          (each) => each.body.kind === "computer" && each.body.id !== self,
        )
        .map(({ body }) => {
          const link = links.get(body.id);
          const state =
            link === undefined
              ? { status: "offline" as const, update: null, path: null }
              : statusOf(link);
          return {
            machine: body.machine as Id<"mch">,
            device: body.id,
            name: body.name,
            ...state,
            last_seen_at: seen.get(body.id) ?? null,
          };
        });
    },

    // 마지막으로 그 컴퓨터와 link가 붙었거나 끊긴 때.
    seen: (device: string) => seen.get(device) ?? null,

    async call(input: {
      machine: string;
      resource: string;
      method: string;
      body: unknown;
    }): Promise<Result<unknown>> {
      const body = computer(input.machine);
      if (body === undefined) return notFound(input.machine);
      const link = links.get(body.id);
      if (link === undefined || link.refused) {
        return err({ code: "unavailable", message: "not connected" });
      }
      const reply = await link.connection.call({
        resource: input.resource,
        method: input.method,
        body: input.body,
      });
      // 그 기계의 오류(code, message, details) 그대로다.
      return reply.ok ? ok(reply.value) : err(reply.error as LophnError);
    },

    watch(machine: string, conditions: EventCondition[]): Result<object> {
      const body = computer(machine);
      if (body === undefined) return notFound(machine);
      watching.set(body.id, conditions);
      void links.get(body.id)?.connection.watch(conditionsOf(body.id));
      return ok({});
    },
  };
}
