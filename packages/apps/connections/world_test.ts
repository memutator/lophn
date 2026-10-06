// 시험 전용: 앱 쌍 연결을 실제 broker endpoint·실제 서명·실제 앱 자식 프로세스로 보는 준비.
// 사실(앱·선언·grant·프로세스 관측)은 시험이 쥔 메모리 출처이고, 앱 자식은 temp 폴더의 실제
// 프로세스다. 사람 데이터 root는 열지 않는다. mod.ts에서 내보내지 않는다.
import {
  type Clock,
  err,
  manualClock,
  ok,
  systemClock,
} from "../../base/mod.ts";
import type { Grant } from "../../contracts/apps/mod.ts";
import {
  type BrokerEndpoint,
  createAppsConnectService,
  createBrokerEndpoint,
  createInvocationBroker,
} from "../permissions/mod.ts";
import {
  type CoreSigner,
  createCoreSigner,
  type ProcessObservation,
  type ProcessSource,
} from "../runtime/mod.ts";
import {
  type FixtureApp,
  fixtureBlueprint,
  startFixtureApp,
} from "../runtime/testing/mod.ts";
import {
  createPairPort,
  installPairPort,
  type PairDirect,
  type PairResponse,
  unixPairDirect,
} from "./mod.ts";
import { observeStarts } from "./origin.ts";
import {
  createPairPreparer,
  type PairDeclarations,
  type PairFacts,
  type PairPreparer,
  type PairSource,
} from "./prepare.ts";

export const BROKER_CREDENTIAL = "pair-broker-credential";
export const PARENT = "inv_01h455vb4pex5v6nkc6gd5fd01";

const id = (prefix: string, n: number) =>
  `${prefix}_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;

export type Peer = {
  app: string;
  release: string;
  nonce: string;
  endpoint: string;
  commands: string[];
  child?: FixtureApp;
};

export type PairWorld = {
  signer: CoreSigner;
  clock: Clock;
  preparer: PairPreparer;
  preparerDeps: { process: ProcessSource; facts: PairFacts };
  // 앱 사실. 시험이 바꾼다.
  declarations: Map<string, PairDeclarations>;
  grants: Grant[];
  observations: Map<string, ProcessObservation>;
  apps: Map<string, { release: string; running: boolean }>;
  peers: Peer[];
  // true인 동안 core 쪽 사실 조회(ledger·supervisor)가 끝나지 않는다.
  stall(on: boolean): void;
  addPeer(
    n: number,
    options?: {
      commands?: string[];
      child?: boolean;
      // 정하면 그 앱 id를 쓴다(approval 요청자와 맞출 때).
      app?: string;
      blueprint?: Record<string, unknown>;
    },
  ): Promise<Peer>;
  declare(source: Peer, target: Peer, commands: string[]): void;
  grant(source: Peer, target: Peer, commands: string[]): Grant;
  revoke(grant: Grant): void;
  // source 앱의 broker 자식 신원.
  child(peer: Peer): PairSource;
  // source 앱의 broker endpoint를 만들고 SDK가 읽는 앱 쌍 통로를 그 endpoint에 잇는다.
  bridge(peer: Peer): Bridge;
  close(): Promise<void>;
};

export type Bridge = {
  endpoint: BrokerEndpoint;
  // direct socket으로 간 요청과 broker로 간 요청의 기록.
  direct: { path: string; command?: string }[];
  posts: string[];
  // 연결 뒤 target direct socket으로 가는 command 호출(broker·core를 지나지 않는다).
  invoke(
    prepared: Pick<Prepared, "endpoint" | "authorization">,
    release: string,
    command: string,
    input: unknown,
    requestKey: string,
    proof?: unknown,
  ): Promise<PairResponse>;
  // 앱이 invocation 시작을 broker에 알린다. caller는 앱이 받은 연결의 출처다.
  start(
    invocation: string,
    caller: Record<string, unknown>,
  ): Promise<PairResponse>;
  post(path: string, body: Record<string, unknown>): Promise<PairResponse>;
};

export async function openPairWorld(
  options: { clock?: Clock } = {},
): Promise<PairWorld> {
  const clock = options.clock ?? systemClock;
  const signer = await createCoreSigner();
  const declarations = new Map<string, PairDeclarations>();
  const observations = new Map<string, ProcessObservation>();
  const apps = new Map<string, { release: string; running: boolean }>();
  const grants: Grant[] = [];
  const peers: Peer[] = [];
  let stalled = false;
  let grantCount = 0;

  const never = <T>() => new Promise<T>(() => {});
  const read = <T>(value: () => T): Promise<T> =>
    stalled ? never<T>() : Promise.resolve(value());

  const facts: PairFacts = {
    app: (app) =>
      read(() => {
        const found = apps.get(app);
        return ok(
          found === undefined ? null : {
            id: app,
            status: "active" as const,
            run_enabled: found.running,
            active_release: found.release,
          },
        );
      }),
    grants: (app) => read(() => ok(grants.filter((item) => item.app === app))),
    declarations: (app) => read(() => ok(declarations.get(app) ?? null)),
  };
  const process: ProcessSource = {
    current: (query) =>
      read(() => {
        const found = observations.get(query.app);
        return ok(found?.mode === query.mode ? found : undefined);
      }),
    restart: () => Promise.resolve(err({ code: "unavailable", message: "x" })),
  };
  const preparer = createPairPreparer({ clock, signer, process, facts });

  const world: PairWorld = {
    signer,
    clock,
    preparer,
    preparerDeps: { process, facts },
    declarations,
    grants,
    observations,
    apps,
    peers,
    stall(on) {
      stalled = on;
    },
    async addPeer(n, peerOptions = {}) {
      const app = peerOptions.app ?? id("app", n);
      let peer: Peer;
      if (peerOptions.child) {
        const blueprint = peerOptions.blueprint ?? fixtureBlueprint();
        const child = await startFixtureApp({
          verifyKey: signer.verifyKey,
          app,
          blueprint,
        });
        peer = {
          app,
          release: child.release as string,
          nonce: child.nonce,
          endpoint: child.endpoint,
          commands: peerOptions.commands ??
            (blueprint["commands"] as { key: string }[]).map((c) => c.key),
          child,
        };
        await openChild(world, peer);
      } else {
        peer = {
          app,
          release: id("rel", n),
          nonce: `nonce-${n}`,
          endpoint: `/nonexistent/${n}.sock`,
          commands: peerOptions.commands ?? ["usage.read"],
        };
      }
      peers.push(peer);
      apps.set(app, { release: peer.release, running: true });
      declarations.set(app, { release: peer.release, app_connections: [] });
      observations.set(app, {
        app,
        mode: "live",
        release: peer.release,
        bundleHash: peer.child?.bundleHash ?? "ab".repeat(32),
        processNonce: peer.nonce,
        endpoint: peer.endpoint,
        ready: true,
        accepting: true,
        commands: peer.commands,
        screens: {},
      });
      return peer;
    },
    declare(source, target, commands) {
      const current = declarations.get(source.app)!;
      declarations.set(source.app, {
        ...current,
        app_connections: [
          ...current.app_connections.filter((item) => item.app !== target.app),
          { app: target.app, commands },
        ],
      });
    },
    grant(source, target, commands) {
      grantCount += 1;
      const made: Grant = {
        id: id("grt", grantCount),
        app: source.app,
        kind: "app.call",
        scope: { kind: "app.call", app: target.app, commands },
        approval: id("apr", grantCount),
        status: "active",
        created_by: "user",
        created_at: "2026-10-06T00:00:00.000Z",
        revoked_by: null,
        revoked_at: null,
      };
      grants.push(made);
      return made;
    },
    revoke(grant) {
      const index = grants.findIndex((item) => item.id === grant.id);
      grants[index] = {
        ...grant,
        status: "revoked",
        revoked_by: "user",
        revoked_at: "2026-10-06T01:00:00.000Z",
      };
    },
    child(peer) {
      return {
        app: peer.app,
        release: peer.release,
        mode: "live",
        processNonce: peer.nonce,
      };
    },
    bridge(peer) {
      const queued: unknown[] = [];
      const invocations = observeStarts(
        createInvocationBroker({
          clock: manualClock(Date.now()),
          queue: {
            enqueue: (message) => {
              queued.push(message);
            },
            pump: () => Promise.resolve(),
          },
        }),
        preparer.paths,
      );
      const endpoint = createBrokerEndpoint({
        session: { child: world.child(peer), credential: BROKER_CREDENTIAL },
        services: {
          invocations,
          apps: createAppsConnectService({ preparer }),
        },
      });
      const direct: { path: string; command?: string }[] = [];
      const posts: string[] = [];
      const post = async (
        path: string,
        body: Record<string, unknown>,
      ): Promise<PairResponse> => {
        posts.push(path);
        const response = await endpoint.handle(
          new Request(`http://lophn.invalid${path}`, {
            method: "POST",
            headers: { authorization: BROKER_CREDENTIAL },
            body: JSON.stringify({
              process_nonce: peer.nonce,
              mode: "live",
              ...body,
            }),
          }),
        );
        return { status: response.status, body: await response.json() };
      };
      const counted: PairDirect = (target, request) => {
        direct.push({ path: request.path });
        return unixPairDirect(target, request);
      };
      const invoke: Bridge["invoke"] = (
        prepared,
        release,
        command,
        ...rest
      ) => {
        direct.push({ path: "/_lophn/commands/invoke", command });
        return invokePair(prepared, release, command, ...rest);
      };
      installPairPort(createPairPort({
        postConnect: (body) => post("/_lophn/broker/apps/connect", body),
        direct: counted,
      }));
      return {
        endpoint,
        direct,
        posts,
        invoke,
        post,
        start: (invocation, caller) =>
          post("/_lophn/broker/invocations/submit", {
            invocation,
            fact: "start",
            summary: {
              operation: { kind: "command", command: "usage.save" },
              trigger: { kind: "direct" },
              caller,
              actor: "user",
              started_at: "2026-10-06T00:00:00.000Z",
            },
          }),
      };
    },
    async close() {
      for (const peer of peers) await peer.child?.stop();
    },
  };
  return world;
}

// 앱 자식에 probe와 open을 보내 쓰기를 받게 한다(machine connection, 제어 경로).
async function openChild(world: PairWorld, peer: Peer): Promise<void> {
  const child = peer.child!;
  const signed = await world.signer.signConnection({
    app: peer.app,
    release: peer.release,
    bundle_hash: child.bundleHash,
    mode: "live",
    process_nonce: peer.nonce,
    actor: "machine",
    credential_ref: "pair-test-machine",
    screens: [],
    screen_sizes: {},
    caller: null,
    commands: [],
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  const authorization = JSON.stringify(signed);
  for (
    const [path, body] of [
      ["/_lophn/control/probe", { process_nonce: peer.nonce }],
      ["/_lophn/control/open", {
        process_nonce: peer.nonce,
        release: peer.release,
      }],
    ] as const
  ) {
    const response = await unixPairDirect(peer.endpoint, {
      method: "POST",
      path,
      authorization,
      body,
    });
    if (response.status !== 200) {
      throw new Error(`control ${path} failed: ${JSON.stringify(response)}`);
    }
  }
}

// 사람이 직접 쓰는 연결(caller 없음)의 서명 envelope. 앱 쌍 호출과 같은 handler를 부르는지 본다.
export async function userAuthorization(
  world: PairWorld,
  peer: Peer,
  commands: string[],
): Promise<string> {
  return JSON.stringify(
    await world.signer.signConnection({
      app: peer.app,
      release: peer.release,
      bundle_hash: peer.child!.bundleHash,
      mode: "live",
      process_nonce: peer.nonce,
      actor: "user",
      credential_ref: "pair-test-user",
      screens: [],
      screen_sizes: {},
      caller: null,
      commands,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    }),
  );
}

export const CONNECT = "/_lophn/broker/apps/connect";

export type Prepared = {
  endpoint: string;
  authorization: string;
  connection: Record<string, unknown>;
};

// source 앱이 broker로 준비를 요청한다(SDK가 하는 일). 실패는 응답 그대로 돌려준다.
export async function connectPair(
  bridge: Bridge,
  app: string,
  commands: string[],
  parent: string | null = null,
): Promise<
  { ok: true; value: Prepared } | { ok: false; response: PairResponse }
> {
  const response = await bridge.post(CONNECT, {
    app,
    commands,
    parent_invocation: parent,
  });
  if (response.status !== 200) return { ok: false, response };
  const body = response.body as {
    endpoint: string;
    connection: Record<string, unknown>;
    signature: string;
  };
  return {
    ok: true,
    value: {
      endpoint: body.endpoint,
      connection: body.connection,
      authorization: JSON.stringify({
        payload: body.connection,
        signature: body.signature,
      }),
    },
  };
}

// 연결 뒤 target direct socket으로 가는 command 호출. broker·core를 지나지 않는다.
export function invokePair(
  prepared: Pick<Prepared, "endpoint" | "authorization">,
  release: string,
  command: string,
  input: unknown,
  requestKey: string,
  proof?: unknown,
): Promise<PairResponse> {
  return unixPairDirect(prepared.endpoint, {
    method: "POST",
    path: "/_lophn/commands/invoke",
    authorization: prepared.authorization,
    body: {
      request_key: requestKey,
      release,
      command,
      ...(input === undefined ? {} : { input }),
      ...(proof === undefined ? {} : { proof }),
    },
  });
}
