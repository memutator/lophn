import assert from "node:assert/strict";
import { test } from "node:test";
import {
  err,
  type LophnError,
  manualClock,
  ok,
  seededRandom,
} from "../../base/mod.ts";
import type { Route } from "../../protocol/base/mod.ts";
import { settingsUpdate } from "../../protocol/config/file.ts";
import { agentCreate } from "../../protocol/lophn-agent/agent-definitions.ts";
import { inputRequestAnswerSecret } from "../../protocol/lophn-agent/input-request.ts";
import { mcpAuthBegin } from "../../protocol/lophn-agent/mcp-settings.ts";
import {
  disconnectProvider,
  providerConnectKey,
} from "../../protocol/lophn-agent/providers.ts";
import { changeSessionSkip } from "../../protocol/lophn-agent/sessions.ts";
import { projectApi } from "../../protocol/projects/project-api.ts";
import { REMOTE_PERSON_ROUTES } from "../../protocol/remote/allowlist.ts";
import { REMOTE_ALLOWED_ROUTES } from "../../protocol/remote/mod.ts";
import {
  devicesClearPush,
  devicesConnected,
  devicesList,
  devicesPushTargets,
  devicesSetPrimary,
  machinesCall,
  machinesWatch,
  rosterForgetAll,
  rosterInvite,
  rosterJoin,
  rosterList,
  rosterRemove,
  rosterRename,
  rosterSetTerminalInput,
  rosterStatements,
  rosterStore,
} from "../../protocol/remote/routes.ts";
import { secretPut } from "../../protocol/secrets/secret-file.ts";
import {
  loginsDelete,
  loginsList,
  loginsRelease,
  loginsSave,
} from "../../protocol/secrets/logins.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import { secretPutHandler } from "../secrets/routes.ts";
import {
  confirmationBinding,
  ConfirmationRegistry,
  CredentialRegistry,
} from "../server/identity/mod.ts";
import {
  type MemoryHandler,
  RouteRegistry,
  type UploadHandler,
} from "../server/mod.ts";
import { createAdmission } from "../supervision/responsiveness/mod.ts";
import {
  createDeviceCredentials,
  createRemoteCall,
  type DeviceCredential,
  devicePrincipal,
} from "./call.ts";
import { createMachineRoutes } from "./machine-routes.ts";

const GRANTED = `dev_0${"1".repeat(25)}`;
const PLAIN = `dev_0${"2".repeat(25)}`;
const SESSION = `ses_0${"1".repeat(25)}`;
const TURN = `trn_0${"1".repeat(25)}`;
const PROVIDER = `pvd_0${"1".repeat(25)}`;
const SECRET_VALUE = "sk-should-never-leave";

const routes: Route[] = [
  secretPut,
  providerConnectKey,
  inputRequestAnswerSecret,
  disconnectProvider,
  settingsUpdate,
  agentCreate,
  projectApi.register,
];

// 허락이 있어도 열지 않는 route다. 두 기기 목록 어디에도 없어야 한다. 목록 file에서 뽑지 않고 이름으로 적는다:
// 누가 이 가운데 하나를 목록에 넣으면 이 표가 실패한다.
const NEVER: Route[] = [
  rosterList,
  rosterInvite,
  rosterJoin,
  rosterRemove,
  rosterSetTerminalInput,
  rosterRename,
  rosterStatements,
  rosterStore,
  rosterForgetAll,
  loginsList,
  loginsSave,
  loginsDelete,
  loginsRelease,
  devicesList,
  devicesSetPrimary,
  devicesConnected,
  devicesClearPush,
  devicesPushTargets,
  machinesCall,
  machinesWatch,
  mcpAuthBegin,
  changeSessionSkip,
];

const upload = (input: Record<string, unknown>) => ({
  input: { ...input, bytes: SECRET_VALUE.length },
  base64: Buffer.from(SECRET_VALUE).toString("base64"),
});
const command = (input: unknown, compare: unknown = {}) => ({
  input,
  compare,
  idempotency_key: "key-1",
  prepared: [],
});
// 사람 route의 대표: secret, provider, 설정 쓰기, agent·project 만들기. 값을 싣는 upload 셋을 포함한다.
const table: [string, unknown][] = [
  ["secrets/put", upload({ name: "provider.openai" })],
  ["providers/connect-key", upload({ target: { definition: "openai" } })],
  [
    "input_request/answer_secret",
    upload({ session: SESSION, tool_call: `tcl_0${"1".repeat(25)}` }),
  ],
  [
    "providers/disconnect",
    // 기기가 보낸 확인 값은 버린다.
    { ...command({ provider: PROVIDER }, { revision: 1 }), confirmation: "x" },
  ],
  ["settings/update", { changes: [] }],
  [
    "agents/create",
    command({ definition: { handle: "helper", name: "Helper", body: "hi" } }),
  ],
  [
    "projects/create",
    command({
      id: `prj_0${"1".repeat(25)}`,
      name: "demo",
      title: "Demo",
      purpose: "",
      folders: [],
    }),
  ],
];

function setup(
  options: {
    // settings/update handler의 답. 기본은 성공이다.
    settings?: () => ReturnType<MemoryHandler>;
    // call이 보는 자격의 target을 비운다. registry가 agent 자격을 session·turn에 묶지 않게 바뀌어도 actor 검사가 막는지 본다.
    looseTargets?: boolean;
  } = {},
) {
  const clock = manualClock(1_700_000_000_000);
  const random = seededRandom(3);
  const registry = new CredentialRegistry({
    epoch: "test",
    random,
    clock,
    // 표의 route는 agent도 받는 정책으로 둔다. agent 자격을 막는 것이 정책이 아니라 call이어야 한다.
    operations: [...REMOTE_ALLOWED_ROUTES, ...REMOTE_PERSON_ROUTES].map(
      (route) => ({
        name: route.name,
        actors: routes.includes(route) ? ["user", "agent"] : ["user"],
        kind: route.kind === "command" ? "command" : "read",
      }),
    ),
  });
  const confirmations = new ConfirmationRegistry({
    clock,
    random: (bytes) => bytes.fill(9),
  });
  const issued: string[] = [];
  // handler와 writer에 닿은 route와, 닿은 upload의 bytes.
  const reached: string[] = [];
  const received: string[] = [];
  const take: UploadHandler = async (_ctx, _input, body) => {
    received.push(await new Response(body.bytes).text());
    return ok({});
  };
  const pathOf = (route: Route) => `${route.resource}/${route.method}`;
  const reach =
    (path: string): MemoryHandler =>
    () => {
      reached.push(path);
      return ok({});
    };
  const seen = options.looseTargets
    ? (Object.assign(Object.create(registry), {
        revalidate(ctx: Pick<AuthenticatedContext, "credential_ref">) {
          const current = registry.revalidate(ctx);
          return current.ok
            ? ok({
                ...current.value,
                scope: { ...current.value.scope, targets: {} },
              })
            : current;
        },
      }) as CredentialRegistry)
    : registry;
  const call = createRemoteCall({
    registry: seen,
    routes: new RouteRegistry([...routes, ...NEVER]),
    clock,
    memory: new Map([
      [
        "settings/update",
        () => {
          reached.push("settings/update");
          return options.settings?.() ?? ok({ changed: [], rejected: [] });
        },
      ],
      ...NEVER.map((route) => [pathOf(route), reach(pathOf(route))] as const),
    ]),
    reads: new Map(
      NEVER.map((route) => [pathOf(route), reach(pathOf(route))] as const),
    ),
    uploads: new Map<string, UploadHandler>([
      // 실제 handler와 가짜 저장소: 기기가 vault 이름을 쓰지 못하는 것은 handler가 막는다.
      [
        "secrets/put",
        secretPutHandler({
          async put(name, value) {
            reached.push("secrets/put");
            received.push(String(value));
            return ok({ name, configured: true });
          },
        }),
      ],
      ...["providers/connect-key", "input_request/answer_secret"].map(
        (path) =>
          [
            path,
            (async (ctx, input, body) => {
              reached.push(path);
              return await take(ctx, input, body);
            }) satisfies UploadHandler,
          ] as const,
      ),
    ]),
    // ledger executor처럼 확인을 대상과 내용에 맞춰 예약하고 소비한다.
    writer: {
      async command(_ctx, envelope) {
        const route = routes.find((each) => each.name === envelope.command)!;
        if (envelope.confirmation !== undefined) {
          const binding = await confirmationBinding(route, envelope.input);
          const reserved = confirmations.reserve({
            ref: envelope.confirmation,
            decision: route.name,
            binding: binding!,
          });
          if (!reserved.ok) return reserved;
          confirmations.consume(envelope.confirmation);
        }
        reached.push(`writer ${route.resource}/${route.method}`);
        return ok({ result: {} }) as never;
      },
      readResult: async () => ok(null),
      close: async () => {},
    },
    admission: createAdmission(),
    granted: (principal) => principal !== devicePrincipal(PLAIN),
    kind: () => "phone",
    async confirm(request) {
      const made = confirmations.issue(request);
      if (!made.ok) return made;
      issued.push(made.value.confirmation);
      return ok(made.value.confirmation);
    },
  });
  const devices = createDeviceCredentials({
    registry,
    record: async () => ok(undefined),
  });
  async function device(id: string) {
    const made = await devices.get(id);
    assert.ok(made.ok);
    return made.value;
  }
  function credential(
    issue: Parameters<CredentialRegistry["issue"]>[0],
  ): DeviceCredential {
    const made = registry.issue(issue);
    assert.ok(made.ok, JSON.stringify(made));
    const context = registry.revalidate({
      credential_ref: made.value.credential_ref,
    });
    assert.ok(context.ok);
    return {
      context: context.value as AuthenticatedContext,
      token: made.value.token,
    };
  }
  async function run(who: DeviceCredential) {
    const codes: [string, string][] = [];
    for (const [path, body] of table) {
      const [resource, method] = path.split("/");
      const done = await call(who, { resource, method, body });
      codes.push([path, done.ok ? "ok" : done.error.code]);
      // 값은 어떤 오류 글에도 실리지 않는다.
      assert.ok(done.ok || !JSON.stringify(done.error).includes(SECRET_VALUE));
    }
    return codes;
  }
  return {
    call,
    reached,
    received,
    issued,
    confirmations,
    device,
    credential,
    run,
  };
}

test("터미널 입력 허락이 없는 기기는 secret, provider, 설정 쓰기 route를 부르지 못한다", async () => {
  const s = setup();
  assert.deepEqual(
    await s.run(await s.device(PLAIN)),
    table.map(([path]) => [path, "forbidden"]),
  );
  assert.deepEqual(s.reached, []);
  assert.deepEqual(s.received, []);
  assert.deepEqual(s.issued, []);

  // 같은 표를 허락받은 기기로 부르면 handler·writer에 닿고, providers/disconnect는 core가 붙인 확인을 소비한 채 writer에 닿는다.
  await s.run(await s.device(GRANTED));
  assert.deepEqual(s.reached, [
    "secrets/put",
    "providers/connect-key",
    "input_request/answer_secret",
    "writer providers/disconnect",
    "settings/update",
    "writer agents/create",
    "writer projects/create",
  ]);
  assert.deepEqual(s.received, [SECRET_VALUE, SECRET_VALUE, SECRET_VALUE]);
  assert.equal(s.issued.length, 1);
  const again = s.confirmations.reserve({
    ref: s.issued[0]!,
    decision: disconnectProvider.name,
    binding: (await confirmationBinding(disconnectProvider, {
      provider: PROVIDER,
    }))!,
  });
  assert.equal(!again.ok && again.error.code, "forbidden");
});

test("agent 자격은 기기의 길로도 secret을 넣거나 확인이 필요한 명령을 통과하지 못한다", async () => {
  // agent 자격의 session·turn target을 call이 보지 않게 해서, scope가 아니라 actor 검사가 막는 것을 본다.
  const s = setup({ looseTargets: true });
  const operations = routes.map((route) => route.name);
  const agent = s.credential({
    actor: `agent:${SESSION}`,
    // 허락받은 기기의 principal을 써도 actor가 user가 아니면 막힌다.
    principal: devicePrincipal(GRANTED),
    scope: { operations, targets: { session: SESSION, turn: TURN } },
    conditions: { session: SESSION, turn: TURN, process: "agent-runtime" },
  });
  // 사람 token(principal user)도 기기의 길로는 사람 route를 부르지 못한다.
  const person = s.credential({
    actor: "user",
    principal: "user",
    scope: { operations, targets: {} },
    conditions: { process: "api" },
  });
  for (const who of [agent, person]) {
    const codes = await s.run(who);
    for (const path of ["secrets/put", "providers/disconnect"]) {
      assert.deepEqual(
        codes.find(([each]) => each === path),
        [path, "forbidden"],
      );
    }
  }
  assert.deepEqual(s.reached, []);
  assert.deepEqual(s.received, []);
  assert.deepEqual(s.issued, []);
});

test("허락받은 기기가 roster, logins, 목록 밖 devices, machines, MCP 로그인 시작, change-skip, vault 이름의 secrets/put을 부르면 forbidden이다", async () => {
  const s = setup();
  const granted = await s.device(GRANTED);
  for (const route of NEVER) {
    const done = await s.call(granted, {
      resource: route.resource,
      method: route.method,
      body: route.kind === "command" ? command({}) : {},
    });
    assert.equal(done.ok ? "ok" : done.error.code, "forbidden", route.name);
  }
  const vault = await s.call(granted, {
    resource: "secrets",
    method: "put",
    body: upload({ name: "login.lgn_x.password" }),
  });
  assert.equal(!vault.ok && vault.error.code, "forbidden");
  assert.deepEqual(s.reached, []);
  assert.deepEqual(s.received, []);

  // 두 목록은 겹치지 않고 사람(actor user)이 부를 수 있는 route만 든다. 아니면 core가 기기 자격을 만들지 못한다.
  const allowed = new Set(REMOTE_ALLOWED_ROUTES.map((route) => route.name));
  assert.deepEqual(
    REMOTE_PERSON_ROUTES.filter((route) => allowed.has(route.name)).map(
      (route) => route.name,
    ),
    [],
  );
  assert.deepEqual(
    [...REMOTE_ALLOWED_ROUTES, ...REMOTE_PERSON_ROUTES]
      .filter((route) => !route.actors.includes("user"))
      .map((route) => route.name),
    [],
  );
});

test("handler가 낸 오류의 details가 기기의 call 결과에 그대로 온다", async () => {
  const details = { reason: "changed_elsewhere" };
  const s = setup({
    settings: () => err({ code: "conflict", message: "changed", details }),
  });
  const done = await s.call(await s.device(GRANTED), {
    resource: "settings",
    method: "update",
    body: { changes: [] },
  });
  assert.deepEqual(done, {
    ok: false,
    error: { code: "conflict", message: "changed", details },
  } satisfies { ok: false; error: LophnError });
});

// 다른 기계는 이 컴퓨터를 사람으로 받는다. 사람의 CLI token(actor user)이 이 길을 타면 그 기계의 사람 route와 자동 확인에 닿는다.
test("CLI의 사람 token으로 machines/call을 부르지 못하고 shell main의 capability는 다른 기계로 가지 않는다", async () => {
  const sent: unknown[] = [];
  const machines = createMachineRoutes({
    links: {
      call: async (input) => {
        sent.push(input);
        return ok({});
      },
      watch: (subscriber, machine, conditions) => {
        sent.push({ subscriber, machine, conditions });
        return ok({});
      },
      forget: () => {},
    },
    capability: (value) => value === "live",
    onEnd: () => {},
  });
  const cli = {
    actor: "user",
    principal: "user",
    conditions: { process: "cli" },
  };
  const machine = `mch_0${"1".repeat(25)}`;
  const call = {
    machine,
    resource: "providers",
    method: "disconnect",
    body: {},
  };
  for (const shell_capability of [undefined, "dead"]) {
    const input = { ...call, shell_capability } as never;
    const called = await machines.call(cli, input);
    assert.equal(!called.ok && called.error.code, "forbidden");
    const watched = machines.watch(cli, {
      machine,
      watcher: "w1",
      conditions: [],
      shell_capability,
    } as never);
    assert.equal(!watched.ok && watched.error.code, "forbidden");
  }
  assert.deepEqual(sent, []);

  const shell = { ...cli, conditions: { process: "electron-main" } };
  assert.ok(
    (await machines.call(shell, { ...call, shell_capability: "live" })).ok,
  );
  assert.ok(
    machines.watch(shell, {
      machine,
      watcher: "w1",
      conditions: [],
      shell_capability: "live",
    }).ok,
  );
  assert.deepEqual(sent, [
    call,
    {
      subscriber: { capability: "live", watcher: "w1" },
      machine,
      conditions: [],
    },
  ]);
});
