// 시험 전용: 실제 core(임시 LOPHN_HOME)와 실제 앱 자식 프로세스로 connect·client를 보는
// 준비. mod.ts에서 내보내지 않는다. core의 supervisor 관측만 시험 출처로 바꿔 끼우고(자식이
// 이 폴더의 실제 앱 프로세스다), 그 밖은 제품 조립 그대로다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../../base/mod.ts";
import type {
  AuthenticatedContext,
  CredentialConditions,
} from "../../../contracts/platform/mod.ts";
import {
  call,
  command,
  type Reply,
} from "../../../../apps/core/testing/approvals-fixture.ts";
import {
  type CoreHarness,
  createCoreHarness,
} from "../../../../apps/core/testing/core.ts";
import type {
  ProcessObservation,
  ProcessQuery,
  ProcessSource,
} from "../connect.ts";
import {
  FIXTURE_RELEASE,
  type FixtureApp,
  fixtureBlueprint,
  startFixtureApp,
} from "./app-process.ts";

export type Login = { token: string; context: AuthenticatedContext };

export const SCREENS = {
  usage: ["full", "panel"],
  overview: ["full", "panel", "card"],
} as const;

export const COMMANDS = [
  "usage.undo",
  "usage.read",
  "usage.save",
  "usage.admin",
  "slow",
  "fail",
];

// supervisor 관측의 시험 출처. 값은 실제 자식에서 만든 것이고 시험이 바꾼다.
export type SourceState = {
  live: ProcessObservation | undefined;
  preview: ProcessObservation | undefined;
  restarts: { app: string; nonce: string }[];
  // true면 supervisor에 닿지 못한 것처럼 답한다.
  down: boolean;
};

function processSource(state: SourceState): ProcessSource {
  return {
    current(query: ProcessQuery) {
      if (state.down) {
        return Promise.resolve(
          err({ code: "unavailable", message: "supervisor is down" }),
        );
      }
      const found = query.mode === "live"
        ? state.live
        : state.preview?.processNonce === query.nonce
        ? state.preview
        : undefined;
      return Promise.resolve(
        ok(found !== undefined && found.app === query.app ? found : undefined),
      );
    },
    restart(app, nonce) {
      state.restarts.push({ app, nonce });
      return Promise.resolve(ok(undefined));
    },
  };
}

export type World = {
  harness: CoreHarness;
  user: Login;
  machine: Login;
  app: string;
  state: SourceState;
  children: FixtureApp[];
  login(
    actor: "user" | "machine" | "coding_agent" | "agent",
    operations: string[],
    options?: {
      targets?: Record<string, string>;
      conditions?: CredentialConditions;
    },
  ): Promise<Login>;
  // 실제 자식을 띄워 observation에 올린다. mode가 live면 probe·open까지 제어 경로로 마친다.
  start(options?: {
    mode?: "live" | "preview";
    ready?: boolean;
  }): Promise<FixtureApp>;
  // 사람의 실행 허락과 release 채택을 ledger에 남긴다.
  allow(): Promise<void>;
  close(): Promise<void>;
};

export function observationOf(
  child: FixtureApp,
  overrides: Partial<ProcessObservation> = {},
): ProcessObservation {
  return {
    app: child.app,
    mode: child.mode,
    release: child.release,
    bundleHash: child.bundleHash,
    processNonce: child.nonce,
    endpoint: child.endpoint,
    ready: true,
    accepting: true,
    commands: COMMANDS,
    screens: SCREENS,
    ...overrides,
  };
}

export async function openWorld(
  options: { sweepMs?: number } = {},
): Promise<World> {
  const documents = await import("../../../../apps/core/documents.ts");
  const apps = await import("../../../../apps/core/apps.ts");
  const fixtures = await import("./mod.ts");
  const permissions = await import("../../permissions/testing/mod.ts");
  const state: SourceState = {
    live: undefined,
    preview: undefined,
    restarts: [],
    down: false,
  };
  const opened = await createCoreHarness({
    // 앱 자식은 실제 시각으로 연결 기한을 비교한다. core 시계도 지금에서 시작한다.
    nowMs: Date.now(),
    teams: [
      { createLedgerRegistration: documents.createLedgerRegistration },
      { createLedgerRegistration: apps.createLedgerRegistration },
      { createLedgerRegistration: fixtures.createLedgerRegistration },
      { createLedgerRegistration: permissions.createLedgerRegistration },
    ],
    teamModules: [
      new URL("../../../../apps/core/documents.ts", import.meta.url).href,
      new URL("../../../../apps/core/apps.ts", import.meta.url).href,
      new URL("./mod.ts", import.meta.url).href,
      new URL("../../permissions/testing/mod.ts", import.meta.url).href,
    ],
    apps: { process: processSource(state), sweepMs: options.sweepMs },
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  let sequence = 0;
  const login: World["login"] = async (actor, operations, extra = {}) => {
    sequence += 1;
    const issued = await harness.credential({
      actor,
      principal: `${actor}-${sequence}`,
      scope: { operations, targets: extra.targets ?? {} },
      conditions: extra.conditions ?? {},
    });
    assert(issued.ok, issued.ok ? "" : issued.error.message);
    return issued.value;
  };
  const user = await login("user", [
    "app.create",
    "app.enable_execution",
    "app.connect",
  ]);
  const machine = await login("machine", [
    "app.connect",
    "runtime.tests.adopt_release",
  ]);
  const created = await call(
    harness,
    "apps/create",
    user.token,
    command({ slug: "usage", name: "Usage", description: "usage app" }),
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
  const app = String(created.body["id"]);
  const revision = String(created.body["revision"]);
  const children: FixtureApp[] = [];
  const world: World = {
    harness,
    user,
    machine,
    app,
    state,
    children,
    login,
    async allow() {
      const adopted = await call(
        harness,
        "runtime/adopt-release",
        machine.token,
        command({ app, release: FIXTURE_RELEASE }),
      );
      assertEquals(adopted.status, 200, JSON.stringify(adopted.body));
      const enabled: Reply = await call(
        harness,
        "apps/enable_execution",
        user.token,
        command({ app }, { compare: { base_revision: revision } }),
      );
      assertEquals(enabled.status, 200, JSON.stringify(enabled.body));
    },
    async start(startOptions = {}) {
      const mode = startOptions.mode ?? "live";
      const child = await startFixtureApp({
        verifyKey: harness.appsControl.verifyKey,
        app,
        mode,
        blueprint: fixtureBlueprint(),
      });
      children.push(child);
      const observation = observationOf(child, {
        ready: startOptions.ready ?? true,
        accepting: startOptions.ready ?? true,
      });
      if (mode === "live") state.live = observation;
      else state.preview = observation;
      if (startOptions.ready !== false) {
        // 제어 경로 그대로 probe와 open을 마친다(machine connection).
        await control(world, child, "/_lophn/control/probe", {
          process_nonce: child.nonce,
        });
        if (mode === "live") {
          await control(world, child, "/_lophn/control/open", {
            process_nonce: child.nonce,
            release: child.release,
          });
        }
      }
      return child;
    },
    async close() {
      for (const child of children) await child.stop();
      await harness.close();
    },
  };
  return world;
}

// machine credential로 core가 서명한 제어 connection을 받아 앱 control 경로를 부른다.
export async function control(
  world: World,
  child: FixtureApp,
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const connected = await call(
    world.harness,
    "apps/connect",
    world.machine.token,
    {
      app: child.app,
      mode: child.mode,
      screens: ["control"],
      screen_sizes: {},
      commands: [],
      ...(child.mode === "preview" ? { preview_nonce: child.nonce } : {}),
    },
  );
  assertEquals(connected.status, 200, JSON.stringify(connected.body));
  return await direct(
    child.endpoint,
    "POST",
    path,
    authorizationOf(connected),
    body,
  );
}

export function authorizationOf(connected: Reply): string {
  return JSON.stringify({
    payload: connected.body["connection"],
    signature: connected.body["signature"],
  });
}

export async function direct(
  endpoint: string,
  method: "GET" | "POST",
  path: string,
  authorization: string | null,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const client = Deno.createHttpClient({
    proxy: { transport: "unix", path: endpoint },
  });
  try {
    const response = await fetch(`http://lophn.invalid${path}`, {
      client,
      method,
      headers: {
        ...(authorization === null ? {} : { authorization }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const json = response.headers.get("content-type")?.includes("json");
    return {
      status: response.status,
      body: text.length === 0 ? null : json ? JSON.parse(text) : text,
    };
  } finally {
    client.close();
  }
}
