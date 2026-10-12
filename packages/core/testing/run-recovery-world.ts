/**
 * 중단 뒤 복구(lophn-agent/harness/waiting-and-recovery) 시험이 같이 쓰는 준비. 실제 core(임시
 * LOPHN_HOME, 실제 ledger)와 fake provider를 띄우고, 사람 요청으로 접수된 run 하나를 만든다. agent
 * runtime은 시험 안에서 조립하며(`runtime()`) 감독 pipe의 blob 준비·credential 발급은 core를 직접 부른다.
 * runtime을 "죽이는" 것은 core 호출 길에 심은 규칙(`die`)이다: 규칙이 맞는 호출 뒤(또는 앞)에 그
 * runtime의 모든 core 호출이 실패한다. 같은 core·ledger·provider 위에 새 runtime을 조립하면 재시작이다.
 * 실제 provider와 사람 데이터 root는 열지 않는다. 제품 main.ts에는 없다.
 */
import { AGENT_RUNTIME_PRINCIPAL } from "../../protocol/lophn-agent/mod.ts";
import { z } from "zod";
import { assert, assertEquals } from "@std/assert";
import {
  createIdSource,
  err,
  formatAt,
  manualClock,
  ok,
  seededRandom,
} from "../../base/mod.ts";
import type { CallModel } from "../../protocol/lophn-agent/mod.ts";
import type {
  AuthenticatedContext,
  ChildMessage,
} from "../../protocol/server/mod.ts";
import {
  createAuthTransport,
  type SecretAttachLike,
} from "../lophn-agent/providers/adapters/auth-transport.ts";
import { createFetchTransport } from "../lophn-agent/providers/adapters/transport.ts";
import { createInvokeModelCall } from "../lophn-agent/providers/invoke.ts";
import {
  createRunCredentials,
  createRunSelector,
} from "../lophn-agent/run-loop/mod.ts";
import {
  BUILTIN_TOOLS,
  type ToolDefinition,
  type ToolHandler,
} from "../lophn-agent/tools/mod.ts";
import type { ToolBinding } from "../lophn-agent/tool-judgment/mod.ts";
import type { ToolLookup } from "../lophn-agent/waiting-and-recovery/mod.ts";
import {
  type FakeProvider,
  type Script,
  startFakeProvider,
} from "../../../tools/fake-provider/mod.ts";
import { createCredentialLink } from "../main/agent-runtime/credential-link.ts";
import {
  agentCall,
  machineCall,
  RUNTIME_MACHINE_ROUTES,
} from "../main/agent-runtime/core-http.ts";
import type { CoreCall } from "../lophn-agent/run-loop/core-call.ts";
import { anthropicPacker } from "../lophn-agent/models/binding.ts";
import { createRunPreparer } from "../lophn-agent/run-loop/prepare.ts";
import {
  createRunDriver,
  type RunDriver,
} from "../lophn-agent/run-loop/driver.ts";
import { createAgentCredentialLink } from "../lophn-agent/run-loop/agent-credentials.ts";
import { createLedgerRegistration as documentsRegistration } from "../projects/register.ts";
import { type Core, startCore } from "../main/daemon/core.ts";
import {
  createLedgerRegistration,
  lophnAgentDefinitions,
} from "../lophn-agent/register.ts";
import {
  call,
  command,
  count,
  inspect,
  type Server,
} from "./approvals-fixture.ts";
import { MACHINE_TOKEN, USER_TOKEN } from "./tool-judgment-world.ts";

export { count, inspect, MACHINE_TOKEN, USER_TOKEN };

const PVD = "pvd_01arz3ndektsv4rrffq69g5fav";
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const SES = "ses_01arz3ndektsv4rrffq69g5fav";
const MSG = "msg_01arz3ndektsv4rrffq69g5fav";
const TARGET = "doc_01h455vb4pex5v6nkc6gd5fdw1";

const USER_OPERATIONS = [
  "ListAssignments",
  "OpenSession",
  "ReadSession",
  "ReceiveMessage",
  "RegisterProvider",
  "ReadModelDefaults",
  "ChangeModelDefaults",
  "ReadRun",
  "StopRun",
  "PauseAssignment",
  "ResumeAssignment",
  "grant_approval_request",
  "reject_approval_request",
  "GetApproval",
  "ListApprovals",
  "ReadApprovalText",
  "project.create",
];
const AGENT_OPERATIONS = [
  "RecordMessage",
  "ReadToolCall",
  "create_approval_request",
  "ReadApprovalText",
  "ListProjects",
  "workspace.read",
];

export function context(
  actor: string,
  operations: readonly string[],
  targets: Record<string, string> = {},
  ref = "none",
): AuthenticatedContext {
  return {
    // 제품 runtime의 machine 자격이다. context 읽기가 이 principal만 연다(documents/contexts).
    principal: actor === "machine" ? AGENT_RUNTIME_PRINCIPAL : actor,
    actor,
    scope: { operations: [...operations], targets },
    conditions: targets,
    credential_ref: `cred-${actor}-${ref}`,
  } as AuthenticatedContext;
}

// 시험이 쓰는 tool. 이름은 lophn 역할이 쓸 수 있는 것이고 효과와 입력은 시험용으로 바꿨다.
// project.list는 읽기, document.create는 확인 없이 되돌릴 수 있는 쓰기, document.save_version은 호출마다
// 사람 확인이 필요한 쓰기다.
function toolDefinition(
  name: string,
  over: Partial<ToolDefinition>,
): ToolDefinition {
  const base = BUILTIN_TOOLS.find((tool) => tool.name === name);
  assert(base !== undefined, name);
  return { ...base, ...over };
}

export const TOOLS: readonly ToolDefinition[] = [
  toolDefinition("project.list", {}),
  toolDefinition("document.create", {
    effect: "write",
    confirm: false,
    reversible: true,
    idempotent: false,
    input: z.strictObject({ note: z.string() }),
  }),
  toolDefinition("document.save_version", {
    effect: "write",
    confirm: true,
    reversible: true,
    idempotent: false,
    input: z.strictObject({ note: z.string() }),
  }),
];

export type Effects = {
  // 쓰기 tool의 실제 효과(외부에 한 번 일어난 일). 중복 효과는 같은 note가 둘 이상으로 보인다.
  writes: string[];
  reads: number;
};

// 한 번의 죽음. 맞는 호출의 앞이나 뒤에서 그 runtime의 모든 core 호출이 실패한다.
export type Death = {
  when: "before" | "after";
  // route 경로의 일부(예 "/v1/tool-calls/finish").
  path: string;
  // 이 경로의 n번째 호출(1부터).
  nth?: number;
};

export type RuntimeOptions = {
  die?: Death;
  // 결과를 모르는 쓰기의 결과 조회(tool 이름 → 조회).
  lookups?: ReadonlyMap<string, ToolLookup>;
  // 죽지 않아도 core 호출 하나를 실패시킨다(저장 실패 시험). 경로의 n번째 호출이다.
  failOnce?: { path: string; nth: number };
};

export type RecoveryRuntime = {
  driver: RunDriver;
  dead(): boolean;
};

export type RecoveryWorld = {
  core: Core;
  server: Server;
  clock: ReturnType<typeof manualClock>;
  provider: FakeProvider;
  run: string;
  session: string;
  assignment: { id: string; revision: number };
  effects: Effects;
  runtime(options?: RuntimeOptions): RecoveryRuntime;
  // 같은 데이터 root로 core를 다시 띄운다(새 port, 시험 credential은 다시 받는다). 이전 runtime은 쓰지 않는다.
  restartCore(): Promise<void>;
  post(
    path: string,
    token: string,
    input: unknown,
    compare?: unknown,
  ): ReturnType<typeof call>;
  read(path: string, token: string, input: unknown): ReturnType<typeof call>;
  dispose(): Promise<void>;
};

let sequence = 0;

export async function openRecoveryWorld(
  script: Script,
): Promise<RecoveryWorld> {
  const home = await Deno.makeTempDir({ prefix: "lophn-recovery-" });
  const clock = manualClock(Date.UTC(2024, 0, 1));
  const provider = startFakeProvider({
    script,
    nowMs: () => clock.nowMs(),
    instant: true,
  });
  const boot = async (seed: number) => {
    const started = await startCore({
      lophnHome: home,
      port: 0,
      teams: [
        { lophnAgentDefinitions, createLedgerRegistration },
        { createLedgerRegistration: documentsRegistration },
      ],
      teamModules: [
        new URL("../lophn-agent/register.ts", import.meta.url).href,
        new URL("../projects/register.ts", import.meta.url).href,
      ],
      clock,
      random: seededRandom(seed),
      testCredentials: true,
    });
    assert(started.ok, started.ok ? "" : JSON.stringify(started.error));
    return started.value;
  };
  let core = await boot(61);
  const server: Server = {
    port: core.port,
    dataRoot: core.dataRoot,
    clock,
    confirmation: (body) =>
      core.confirmation?.(body) ??
        Promise.resolve({ ok: false as const, error: { message: "none" } }),
  };
  const accept = async (
    ctx: AuthenticatedContext,
    token: string,
    recorded = true,
  ) => {
    const accepted = await core.acceptTestCredential?.(ctx, token);
    assert(accepted?.ok, JSON.stringify(accepted));
    if (recorded) assert((await core.record(ctx)).ok);
  };
  const machineOperations = [
    ...new Set(RUNTIME_MACHINE_ROUTES.map((route) => route.name)),
  ];
  // 다시 뜬 core는 ledger에 남은 credential 기록을 그대로 두고 token만 새로 받는다.
  const acceptBase = async (recorded: boolean) => {
    await accept(
      context("machine", machineOperations),
      MACHINE_TOKEN,
      recorded,
    );
    await accept(context("user", USER_OPERATIONS), USER_TOKEN, recorded);
  };
  await acceptBase(true);
  const post = (
    path: string,
    token: string,
    input: unknown,
    compare: unknown = {},
  ) => call(server, path, token, command(input, { compare }));

  const registered = await post("providers/register", USER_TOKEN, {
    id: PVD,
    name: "fixture",
    definition: {
      key: "anthropic",
      display_name: "Anthropic",
      protocols: ["anthropic-messages"],
      auth_kinds: ["none"],
      models_endpoint: null,
      oauth: null,
      revision: "2026-01-01",
    },
    endpoint: provider.url,
    protocol: "anthropic-messages",
    credential: { kind: "none", preparation: null },
  });
  assertEquals(registered.status, 200, JSON.stringify(registered.body));
  // lophn이 쓸 model은 Workspace의 role slot이 정한다(catalog에 있는 이름이어야 한다).
  const defaults = await call(
    server,
    "agent-model-defaults/read",
    USER_TOKEN,
    {},
  );
  const chosen = await post("agent-model-defaults/change", USER_TOKEN, {
    lophn: {
      provider: PVD,
      model_name: "claude-sonnet-4-5",
      option_values: {},
    },
  }, {
    settings_seq: (defaults.body["defaults"] as { settings_seq: string })
      .settings_seq,
  });
  assertEquals(chosen.status, 200, JSON.stringify(chosen.body));
  const listed = await call(server, "assignments/list", MACHINE_TOKEN, {});
  const lophn = (listed.body["assignments"] as {
    id: string;
    role: string;
    revision: number;
  }[]).find((entry) => entry.role === "lophn");
  assert(lophn !== undefined);
  // 세션은 쓸 수 있는 project 하나를 자리로 받는다.
  const project = await post("projects/create", USER_TOKEN, {
    id: PROJECT,
    name: "alpha",
    title: "alpha",
    purpose: "",
    folders: [],
    tracking: { enabled: false, patterns: [], use_gitignore: false },
  });
  assertEquals(project.status, 200, JSON.stringify(project.body));
  const opened = await post("sessions/open", USER_TOKEN, {
    id: SES,
    assignment: lophn.id,
    work_place: { kind: "project", id: PROJECT },
    opening_context: null,
  }, { assignment_revision: lophn.revision, assignment_state: "enabled" });
  assertEquals(opened.status, 200, JSON.stringify(opened.body));
  const session = await call(server, "sessions/read", USER_TOKEN, {
    session: SES,
  });
  const sent = await post("messages/receive", USER_TOKEN, {
    id: MSG,
    session: SES,
    content: {
      schema_version: 1,
      parts: [{ kind: "text", text: "Please write three notes." }],
    },
    mode: "request",
  }, {
    session_state: "open",
    session_state_seq:
      (session.body as { session: { state_seq: string } }).session.state_seq,
    assignment_revision: lophn.revision,
    assignment_state: "enabled",
  });
  assertEquals(sent.status, 200, JSON.stringify(sent.body));
  const run = (sent.body as { message: { run: string } }).message.run;

  let restarts = 0;
  const effects: Effects = { writes: [], reads: 0 };
  const model: CallModel = {
    provider: PVD,
    name: "fixture-model",
    protocol: "anthropic-messages",
    credential_revision: null,
    option_values: { requested: {}, applied: {} },
    limits: {
      context_limit: 200000,
      input_limit: 150000,
      output_limit: 8192,
      supports_tools: true,
    },
    catalog_basis: {},
    price_basis: null,
    billing_route: "api",
  };
  const attach: SecretAttachLike = {
    send: (_input, transmit) => transmit("none"),
  };
  const invoke = createInvokeModelCall({
    transport: createAuthTransport({
      attach,
      transport: createFetchTransport(),
      context: {} as never,
      use: {} as never,
      operation: "model.call",
      headerName: "x-api-key",
      kind: "api_key",
    }),
    nowMs: () => Date.now(),
    at: formatAt,
  });

  function runtime(options: RuntimeOptions = {}): RecoveryRuntime {
    let dead = false;
    const counts = new Map<string, number>();
    let failures = 0;
    // 감독 pipe가 아닌 시험의 core 호출 길. 죽은 runtime은 아무것도 부르지 못한다.
    const guard = (inner: CoreCall): CoreCall => async (path, body) => {
      if (dead) {
        return err({ code: "unavailable", message: "the runtime is gone" });
      }
      if (
        options.failOnce !== undefined && path.includes(options.failOnce.path)
      ) {
        failures += 1;
        if (failures === options.failOnce.nth) {
          return err({ code: "unavailable", message: "the write was lost" });
        }
      }
      const rule = options.die;
      const hit = rule !== undefined && path.includes(rule.path) &&
        (counts.set(rule.path, (counts.get(rule.path) ?? 0) + 1),
          counts.get(rule.path) === (rule.nth ?? 1));
      if (hit && rule.when === "before") {
        dead = true;
        return err({ code: "unavailable", message: "the runtime is gone" });
      }
      const result = await inner(path, body);
      if (hit && rule.when === "after") dead = true;
      return result;
    };
    const machine = guard(machineCall({
      port: core.port,
      credential: () => MACHINE_TOKEN,
    }));
    const issuer = {
      async issue(input: {
        actor: string;
        scope: {
          operations: readonly string[];
          targets: Record<string, string>;
        };
        conditions: Record<string, string>;
      }) {
        sequence += 1;
        const token = `agent${sequence}`.padEnd(43, "q");
        const ctx = context(
          input.actor,
          input.scope.operations,
          input.scope.targets,
          `${sequence}`,
        );
        await accept(
          { ...ctx, conditions: input.conditions } as AuthenticatedContext,
          token,
        );
        return ok({ token, credential_ref: ctx.credential_ref });
      },
      endBy: () => 0,
    };
    const coreSide = createAgentCredentialLink({
      issuer: issuer as never,
      machine: machineCall({
        port: core.port,
        credential: () => MACHINE_TOKEN,
      }),
      process: "agent-runtime",
      operationsFor: () => AGENT_OPERATIONS,
    });
    const link: ReturnType<typeof createCredentialLink> = createCredentialLink({
      async send(message: ChildMessage) {
        const response = await coreSide.onMessage(message);
        if (response !== undefined) link.onParent(response);
      },
      timeoutMs: 5000,
    });
    const credentials = createRunCredentials({
      issuer: link.issuer,
      operations: AGENT_OPERATIONS,
      process: "agent-runtime",
    });
    const ids = createIdSource({ clock, random: seededRandom(99 + sequence) });
    const binding: ToolBinding = {
      resolve: (input) =>
        ok({
          concern: "recovery-test",
          operation: "recovery.write",
          contractRevision: "1",
          targets: [{ id: TARGET, reversibility: "reversible" as const }],
          comparison: {},
          changes: `write a note ${JSON.stringify(input)}`,
          external: null,
          reversibility: "the note can be removed",
        }),
    };
    const handlers = (): ReadonlyMap<string, ToolHandler> =>
      new Map<string, ToolHandler>([
        ["project.list", () => {
          effects.reads += 1;
          return Promise.resolve(ok({
            status: "success" as const,
            summary: "No projects.",
            content: { projects: [] },
            complete: true,
            source: null,
            continuation: null,
            pending: [],
          }));
        }],
        ...["document.create", "document.save_version"].map((name) =>
          [name, (input: unknown) => {
            effects.writes.push((input as { note: string }).note);
            return Promise.resolve(ok({
              status: "success" as const,
              summary: `Wrote ${(input as { note: string }).note}.`,
              content: { note: (input as { note: string }).note },
              complete: true,
              source: null,
              continuation: null,
              pending: [],
            }));
          }] as [string, ToolHandler]
        ),
      ]);
    const preparer = createRunPreparer({
      clock,
      ids,
      machine,
      blobs: {
        async prepare(purpose, bytes) {
          if (dead) {
            return err({ code: "unavailable", message: "the runtime is gone" });
          }
          const prepared = await core.prepareBlob({
            principal: AGENT_RUNTIME_PRINCIPAL,
            purpose,
            bytes: new ReadableStream({
              start(controller) {
                controller.enqueue(bytes);
                controller.close();
              },
            }),
          });
          return prepared.ok
            ? ok({
              hash: prepared.value.hash,
              size_bytes: prepared.value.size_bytes,
            })
            : prepared;
        },
      },
      agentCall: (token) => guard(agentCall({ port: core.port, token })),
      resolveModel: () =>
        Promise.resolve(ok({
          call: model,
          endpoint: provider.url,
          usageRevision: "usage-1",
          timeoutMs: 20_000,
          pack: anthropicPacker({ model: model.name, maxTokens: 4096 }),
          invoke,
          available: () => Promise.resolve(true),
        })),
      toolkit: {
        definitions: TOOLS,
        binding: (definition) =>
          definition.effect === "read" ? undefined : binding,
        handlers: () => handlers(),
        targets: () => [TARGET],
        ...(options.lookups === undefined
          ? {}
          : { lookups: () => options.lookups! }),
      },
      product: "PRODUCT RULES",
      rolePrompt: () => Promise.resolve(ok("ROLE RULES")),
      instructions: {
        files: {
          read: () => Promise.resolve(ok(null)),
        },
        redact: (text) => text,
      },
    });
    const driver = createRunDriver({
      selector: createRunSelector({ read: machine }),
      credentials,
      ...preparer,
    });
    return { driver, dead: () => dead };
  }

  return {
    get core() {
      return core;
    },
    server,
    clock,
    provider,
    run,
    session: SES,
    assignment: { id: lophn.id, revision: lophn.revision },
    effects,
    runtime,
    post,
    read: (path, token, input) => call(server, path, token, input),
    async restartCore() {
      await core.shutdown();
      restarts += 1;
      core = await boot(61 + restarts);
      server.port = core.port;
      await acceptBase(false);
    },
    async dispose() {
      await provider.close();
      await core.shutdown();
      await Deno.remove(home, { recursive: true });
    },
  };
}
