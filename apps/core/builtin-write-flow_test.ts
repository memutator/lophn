// lophn-agent/harness/tool-judgment·tools: 내장 쓰기 tool이 제품 runtime 조립(`productToolkit`)에서
// 실제 core(임시 LOPHN_HOME, 실제 ledger와 documents·apps·coding-agent tickets)를 지나 판정·진입·
// 실행되는지 본다. run은 selector → StartRun → agent credential → model call(fake provider의 실제
// HTTP) → tool 판정 → 진입 → 종료 기록의 실제 길(`createRunPreparer`·`createRunDriver`)이고 실행기를
// 직접 부르지 않는다. 실제 provider와 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import {
  createIdSource,
  formatAt,
  manualClock,
  ok,
  seededRandom,
} from "../../packages/base/mod.ts";
import type { CallModel } from "../../packages/contracts/lophn-agent/mod.ts";
import type {
  AuthenticatedContext,
  ChildMessage,
} from "../../packages/contracts/platform/mod.ts";
import {
  createAuthTransport,
  type SecretAttachLike,
} from "../../packages/lophn-agent/harness/provider/adapters/auth-transport.ts";
import { createFetchTransport } from "../../packages/lophn-agent/harness/provider/adapters/transport.ts";
import { createInvokeModelCall } from "../../packages/lophn-agent/harness/provider/invoke.ts";
import {
  createRunCredentials,
  createRunSelector,
} from "../../packages/lophn-agent/harness/run-loop/mod.ts";
import {
  BUILTIN_TOOLS,
  runOperations,
} from "../../packages/lophn-agent/harness/tools/mod.ts";
import { startFakeProvider, type Step } from "../../tools/fake-provider/mod.ts";
import { createCredentialLink } from "../agent-runtime/credential-link.ts";
import {
  agentCall,
  machineCall,
  RUNTIME_MACHINE_ROUTES,
} from "../agent-runtime/core-http.ts";
import { anthropicPacker } from "../agent-runtime/model-binding.ts";
import { productToolkit } from "../agent-runtime/product-driver.ts";
import { createRunPreparer } from "../agent-runtime/prepare.ts";
import { createRunDriver } from "../agent-runtime/run-driver.ts";
import { createAgentCredentialLink } from "./agent-credentials.ts";
import { createLedgerRegistration as createAppsRegistration } from "./apps.ts";
import { codingAgentConnectionDefinitions } from "./coding-agent.ts";
import { startCore } from "./core.ts";
import { createLedgerRegistration as createDocumentsRegistration } from "./documents.ts";
import {
  createLedgerRegistration,
  lophnAgentDefinitions,
} from "./lophn-agent.ts";
import { createCoreRegistration as createTicketPortsRegistration } from "./ticket-ports.ts";
import { ticketDefinitions } from "./tickets.ts";
import {
  call,
  command,
  count,
  decide,
  inspect,
  type Server,
} from "./testing/approvals-fixture.ts";
import { MACHINE_TOKEN, USER_TOKEN } from "./testing/tool-judgment-world.ts";

const PVD = "pvd_01arz3ndektsv4rrffq69g5fav";
const SES = "ses_01arz3ndektsv4rrffq69g5fav";
const MSG = "msg_01arz3ndektsv4rrffq69g5fav";
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const ABSENT_DOCUMENT = "doc_01arz3ndektsv4rrffq69g5fb9";
const ABSENT_VERSION = "ver_01arz3ndektsv4rrffq69g5fb9";

const QUESTION_TOKEN = "q".repeat(43);
const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";

const USER_OPERATIONS = [
  "ListAssignments",
  "OpenSession",
  "ReadSession",
  "ReceiveMessage",
  "RegisterProvider",
  "ReadRun",
  "grant_approval_request",
  "reject_approval_request",
  "GetApproval",
  "ListApprovals",
  "ReadApprovalText",
  "project.create",
  "app.create",
  "AnswerQuestion",
];
// run이 제공하는 내장 tool의 소유 contract와, 판정이 읽는 것·ask가 쓰는 approval request 생성이다.
const AGENT_OPERATIONS = [
  ...runOperations(BUILTIN_TOOLS),
  "RecordMessage",
  "ReadToolCall",
  "create_approval_request",
  "ReadApprovalText",
];

function context(
  actor: string,
  operations: readonly string[],
  targets: Record<string, string> = {},
  ref = "none",
): AuthenticatedContext {
  return {
    principal: actor,
    actor,
    scope: { operations: [...operations], targets },
    conditions: targets,
    credential_ref: `cred-${actor}-${ref}`,
  } as AuthenticatedContext;
}

const CONFIRMED = BUILTIN_TOOLS.map((tool) =>
  tool.name === "document.create" ? { ...tool, confirm: true } : tool
);

type Options = {
  // model 응답 script. app ID를 입력에 쓰는 시험은 app을 만든 뒤에 받는다.
  steps: Step[] | ((app: string) => Step[]);
  // 호출마다 사람 확인이 필요한 정의로 바꾼 document.create(ask 경로의 시험용 정의).
  confirmCreate?: boolean;
  // n번째 model 호출을 release()까지 붙들어 run이 진행 중인 채로 사람 쪽 일(질문 답)을 끼운다.
  // 풀린 호출과 그 뒤는 nextScript()로 바꾼 fake provider로 간다.
  hold?: number;
};

async function openWorld(options: Options) {
  const home = await Deno.makeTempDir({ prefix: "lophn-builtin-write-" });
  const work = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-builtin-write-work-" }),
  );
  const clock = manualClock(Date.UTC(2024, 0, 1));
  const providers: ReturnType<typeof startFakeProvider>[] = [];
  let active: ReturnType<typeof startFakeProvider> | undefined;
  let modelCalls = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [
      { lophnAgentDefinitions, createLedgerRegistration },
      { createLedgerRegistration: createDocumentsRegistration },
      { createLedgerRegistration: createAppsRegistration },
      { codingAgentConnectionDefinitions },
      { ticketDefinitions },
      { createCoreRegistration: createTicketPortsRegistration },
    ],
    teamModules: [
      new URL("./lophn-agent.ts", import.meta.url).href,
      new URL("./documents.ts", import.meta.url).href,
      new URL("./apps.ts", import.meta.url).href,
      new URL("./coding-agent.ts", import.meta.url).href,
      new URL("./tickets.ts", import.meta.url).href,
      new URL("./ticket-ports.ts", import.meta.url).href,
    ],
    clock,
    random: seededRandom(61),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : JSON.stringify(started.error));
  const core = started.value;
  const server: Server = {
    port: core.port,
    dataRoot: core.dataRoot,
    clock,
    confirmation: (body) =>
      Promise.resolve(core.confirmation?.(body as never) as never),
  };
  const accept = async (ctx: AuthenticatedContext, token: string) => {
    const accepted = await core.acceptTestCredential?.(ctx, token);
    assert(accepted?.ok, JSON.stringify(accepted));
    assert((await core.record(ctx)).ok);
  };
  const machineOperations = [
    ...new Set(RUNTIME_MACHINE_ROUTES.map((route) => route.name)),
  ];
  await accept(context("machine", machineOperations), MACHINE_TOKEN);
  await accept(context("user", USER_OPERATIONS), USER_TOKEN);
  const user = (path: string, input: unknown, compare: unknown = {}) =>
    call(server, path, USER_TOKEN, command(input, { compare }));

  const registered = await user("providers/register", {
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
    // 등록은 기록일 뿐이다. run의 model 호출 주소는 runtime 조립(resolveModel)이 정한다.
    endpoint: "http://127.0.0.1:9",
    protocol: "anthropic-messages",
  });
  assertEquals(registered.status, 200, JSON.stringify(registered.body));
  // 문서를 둘 project 하나와 ticket을 둘 app 하나.
  const project = await user("projects/create", {
    id: PROJECT,
    name: "alpha",
    title: "alpha",
    purpose: "",
    folders: [{ path: `${work}/alpha-folder`, description: "" }],
    tracking: { enabled: false, patterns: [], use_gitignore: false },
  });
  assertEquals(project.status, 200, JSON.stringify(project.body));
  const app = await user("apps/create", {
    slug: "notes",
    name: "notes",
    description: "notes app",
  });
  assertEquals(app.status, 200, JSON.stringify(app.body));
  const appId = String(app.body["id"]);
  active = startFakeProvider({
    script: {
      steps: typeof options.steps === "function"
        ? options.steps(appId)
        : options.steps,
    },
    nowMs: () => clock.nowMs(),
    instant: true,
  });
  providers.push(active);

  const listed = await call(server, "assignments/list", MACHINE_TOKEN, {});
  const lophn = (listed.body["assignments"] as {
    id: string;
    role: string;
    revision: number;
  }[]).find((entry) => entry.role === "lophn");
  assert(lophn !== undefined);
  const opened = await user("sessions/open", {
    id: SES,
    assignment: lophn.id,
    role: "lophn",
    work_place: { kind: "global", id: null },
    continued_from: null,
  }, { assignment_revision: lophn.revision, assignment_state: "enabled" });
  assertEquals(opened.status, 200, JSON.stringify(opened.body));
  // 사람 요청 하나를 보내고 접수된 run을 돌려준다.
  async function send(message: string, text: string): Promise<string> {
    const session = await call(server, "sessions/read", USER_TOKEN, {
      session: SES,
    });
    const current = await call(server, "assignments/list", MACHINE_TOKEN, {});
    const assignment = (current.body["assignments"] as {
      id: string;
      role: string;
      revision: number;
    }[]).find((entry) => entry.role === "lophn")!;
    const sent = await user("messages/receive", {
      id: message,
      session: SES,
      content: { schema_version: 1, parts: [{ kind: "text", text }] },
      mode: "request",
    }, {
      session_state: "open",
      session_state_seq:
        (session.body as { session: { state_seq: string } }).session.state_seq,
      assignment_revision: assignment.revision,
      assignment_state: "enabled",
    });
    assertEquals(sent.status, 200, JSON.stringify(sent.body));
    return (sent.body as { message: { run: string } }).message.run;
  }
  const run = await send(MSG, "Please write it down.");

  const model: CallModel = {
    provider: PVD,
    name: "fixture-model",
    protocol: "anthropic-messages",
    credential_key: null,
    credential_revision: null,
    options: {},
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
  let sequence = 0;
  const machine = machineCall({
    port: core.port,
    credential: () => MACHINE_TOKEN,
  });
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
    machine,
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
  const ids = createIdSource({ clock, random: seededRandom(99) });
  const preparer = createRunPreparer({
    clock,
    ids,
    machine,
    blobs: {
      async prepare(purpose, bytes) {
        const prepared = await core.prepareBlob({
          principal: "machine",
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
    agentCall: (token) => agentCall({ port: core.port, token }),
    resolveModel: () =>
      Promise.resolve(ok({
        call: model,
        endpoint: active!.url,
        usageRevision: "usage-1",
        timeoutMs: 20_000,
        pack: anthropicPacker({ model: model.name, maxTokens: 4096 }),
        invoke: async (input, signal) => {
          modelCalls += 1;
          if (modelCalls === options.hold) await gate;
          return invoke({ ...input, endpoint: active!.url }, signal);
        },
        available: () => Promise.resolve(true),
      })),
    // 제품 조립과 같은 tool 묶음이다. ask 시험만 정의 하나를 확인 필요로 바꾼다.
    toolkit: {
      ...productToolkit({ machine, ids }),
      ...(options.confirmCreate === true ? { definitions: CONFIRMED } : {}),
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
  return {
    server,
    driver,
    run,
    send,
    appId,
    assignment: lophn.id,
    user,
    accept,
    release: () => release(),
    // 이어질 model 호출이 갈 새 fake provider의 script다.
    nextScript(steps: Step[]) {
      active = startFakeProvider({
        script: { steps },
        nowMs: () => clock.nowMs(),
        instant: true,
      });
      providers.push(active);
    },
    // 진행 중인 run에 묶인 agent 자격으로 질문을 만들고 사람이 채택 답을 고른다.
    async adoptedQuestion(question: string, document: string, version: string) {
      await accept(
        {
          ...context(`agent:${lophn.id}`, ["CreateQuestion"], {
            assignment: lophn.id,
            run,
          }, "question"),
          conditions: { assignment: lophn.id, run },
        } as AuthenticatedContext,
        QUESTION_TOKEN,
      );
      const created = await call(
        server,
        "questions/create",
        QUESTION_TOKEN,
        command({
          id: question,
          run,
          session: SES,
          prompt: "Which plan do we take?",
          reason: "One of two plans has to be adopted.",
          options: [{
            key: "one",
            label: "First",
            description: "The first plan.",
            evidence: [],
            adoption: { document, version, section: null },
            action: null,
          }],
          recommendation: null,
          expires_at: null,
        }),
      );
      assertEquals(created.status, 200, JSON.stringify(created.body));
      const seq = String(
        ((created.body["result"] ?? created.body) as { created_seq: string })
          .created_seq,
      );
      const answered = await user("questions/answer", {
        question,
        created_seq: seq,
        answer: { kind: "option", option_key: "one" },
      }, { created_seq: seq });
      assertEquals(answered.status, 200, JSON.stringify(answered.body));
    },
    async grant(approval: string) {
      const read = await call(server, "approvals/get", USER_TOKEN, {
        approval,
      });
      assertEquals(read.status, 200, JSON.stringify(read.body));
      const reply = await decide(
        server,
        USER_TOKEN,
        read.body["request"] as never,
        "grant",
      );
      assertEquals(reply.status, 200, JSON.stringify(reply.body));
    },
    async dispose() {
      for (const started of providers) await started.close();
      await core.shutdown();
      await Deno.remove(home, { recursive: true });
      await Deno.remove(work, { recursive: true });
    },
  };
}

type World = Awaited<ReturnType<typeof openWorld>>;

function step(
  id: string,
  name: string,
  args: unknown,
): Step {
  return {
    id,
    protocol: "messages",
    reply: {
      text: "I will write it.",
      toolCalls: [{ id: `toolu_${id}`, name, arguments: JSON.stringify(args) }],
      usage: { input: 20, output: 8 },
      stop: "tool_calls",
    },
  };
}

const ANSWER: Step = {
  id: "answer",
  protocol: "messages",
  reply: { text: "Done.", usage: { input: 40, output: 9 }, stop: "end" },
};

const DOCUMENT = {
  title: "Notes",
  place: { kind: "project", id: PROJECT },
  name: "notes",
  text: "# Notes\n\nWritten by a run.\n",
  media_type: "text/markdown",
};

function rows(world: World, sql: string, params: string[] = []) {
  return inspect(world.server, sql, params);
}

const TOOL_CALLS =
  "select tool, state, effect, json_extract(outcome, '$.kind') as outcome_kind, json_extract(outcome, '$.code') as outcome_code, json_extract(decision, '$.decision') as decision from tool_calls where run = ?";
const DOCUMENTS =
  "select count(*) as n from events where type = 'DocumentCreated'";
const APPROVALS = "select count(*) as n from approval_requests";

async function start(world: World) {
  const result = await world.driver.startNext();
  assert(result.kind === "started", JSON.stringify(result));
  assertEquals(result.run, world.run);
  return await result.done;
}

Deno.test("lophn-agent/harness/tool-judgment#R3: 제품 조립에서 run의 document.create는 소유 계약으로 대상을 확인하고 allow로 새 문서 version을 저장한다", async () => {
  const world = await openWorld({
    steps: [step("write", "document.create", DOCUMENT), ANSWER],
  });
  try {
    const end = await start(world);
    assertEquals(end, {
      kind: "finished",
      outcome: { kind: "completed", reason: "answer_completed" },
    });
    assertEquals(count(world.server, DOCUMENTS), 1);
    const tools = rows(world, TOOL_CALLS, [world.run]);
    assertEquals(tools.length, 1);
    assertEquals(tools[0]!["tool"], "document.create");
    assertEquals(tools[0]!["effect"], "write");
    assertEquals(tools[0]!["outcome_kind"], "success");
    // 승인 없이 되돌릴 수 있는 쓰기로 판정했다.
    assertEquals(count(world.server, APPROVALS), 0);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/tool-judgment#R1 #R8 #R6: 제품 조립에서 ask인 쓰기는 approval request를 만들고 대상을 건드리지 않은 채 기다리며, 허락 뒤 같은 run이 이어 정확히 한 번 쓴다", async () => {
  const world = await openWorld({
    steps: [step("write", "document.create", DOCUMENT), ANSWER],
    confirmCreate: true,
  });
  try {
    const end = await start(world);
    assertEquals((end as { kind: string }).kind, "waiting");
    assertEquals(count(world.server, APPROVALS), 1);
    assertEquals(count(world.server, DOCUMENTS), 0);
    const tools = rows(world, TOOL_CALLS, [world.run]);
    assertEquals(tools.length, 1);
    assertEquals(tools[0]!["state"], "requested");
    // 아직 결정이 없으면 계속 기다리고 대상은 그대로다.
    const waiting = await world.driver.resume(world.run);
    assertEquals(waiting.result, "waiting");
    assertEquals(count(world.server, DOCUMENTS), 0);

    const approval = String(
      rows(world, "select id from approval_requests")[0]!["id"],
    );
    // 요청은 이 run의 agent 자격으로 만들었다(P9: agent는 허락하지 않는다).
    assertEquals(
      rows(world, "select requester from approval_requests")[0]!["requester"],
      `agent:${world.assignment}`,
    );
    await world.grant(approval);
    const resumed = await world.driver.resume(world.run);
    assertEquals(resumed.result, "resumed");
    assertEquals((await resumed.done!).kind, "finished");
    assertEquals(count(world.server, DOCUMENTS), 1);
    assertEquals(
      count(
        world.server,
        "select count(*) as n from events where type = 'ToolCallStarted'",
      ),
      1,
    );
    assertEquals(
      rows(world, TOOL_CALLS, [world.run])[0]!["outcome_kind"],
      "success",
    );
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/tool-judgment#R2: 범위 밖 쓰기는 없는 대상과 같은 답으로 거절되고 approval request도 변경도 없다", async () => {
  const world = await openWorld({
    steps: [
      step("save", "document.save_version", {
        document: ABSENT_DOCUMENT,
        base_version: ABSENT_VERSION,
        text: "# Notes\n",
        media_type: "text/markdown",
      }),
      ANSWER,
    ],
  });
  try {
    const end = await start(world);
    assertEquals((end as { kind: string }).kind, "finished");
    const tools = rows(world, TOOL_CALLS, [world.run]);
    assertEquals(tools.length, 1);
    // 없는 문서의 저장은 미실행이다.
    for (const tool of tools) {
      assertEquals(tool["outcome_kind"], "not_executed");
      assertEquals(tool["outcome_code"], "denied");
    }
    assertEquals(count(world.server, APPROVALS), 0);
    assertEquals(count(world.server, DOCUMENTS), 0);
  } finally {
    await world.dispose();
  }
});

const TICKET = {
  app: "",
  kind: "implementation",
  title: "Redact the leaf before the snapshot",
  what: "redact the leaf",
  why: "the snapshot shows the raw leaf",
  references: [] as unknown[],
  adoption_questions: [] as unknown[],
  conditions: [
    { kind: "app_test" },
    {
      kind: "test_command",
      executable: "deno",
      argv: ["task", "test"],
      cwd: ".",
      timeout_ms: 60_000,
      expected_exit_code: 0,
    },
  ],
  inspect: ["src/leaf.ts"],
  preserve: [],
  problems: [],
  needs: [],
};

Deno.test("coding-agent/tickets#R3: 제품 core의 QuestionAdoptions port로 run의 ticket.create가 사람이 채택한 질문 답을 근거로 실행 준비 ticket을 만든다", async () => {
  // 첫 model 응답이 문서를 만들고, 둘째 호출은 사람이 질문에 답하는 동안 붙든다.
  const world = await openWorld({
    steps: [step("write", "document.create", DOCUMENT)],
    hold: 2,
  });
  try {
    const started = await world.driver.startNext();
    assert(started.kind === "started", JSON.stringify(started));
    // run이 진행 중이고 문서가 저장됐다. 그 판을 채택하는 질문을 내고 사람이 고른다.
    for (let waited = 0; waited < 200; waited++) {
      if (count(world.server, DOCUMENTS) === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const saved = rows(
      world,
      "select json_extract(result, '$.content.reference.document') as document, json_extract(result, '$.content.reference.version') as version from tool_calls",
    )[0]!;
    assert(typeof saved["version"] === "string", JSON.stringify(saved));
    const version = String(saved["version"]);
    await world.adoptedQuestion(QUESTION, String(saved["document"]), version);
    world.nextScript([
      step("ticket", "ticket.create", {
        ...TICKET,
        app: world.appId,
        references: [{
          kind: "version",
          target: version,
          address: {
            place: "alpha",
            document: "notes",
            section: null,
            version: 1,
          },
          section: null,
        }],
        adoption_questions: [QUESTION],
      }),
      ANSWER,
    ]);
    world.release();
    assertEquals((await started.done).kind, "finished");
    const created = rows(world, TOOL_CALLS, [world.run]).find((tool) =>
      tool["tool"] === "ticket.create"
    )!;
    assertEquals(created["outcome_kind"], "success");
    const tickets = rows(world, "select app, readiness from tickets");
    assertEquals(tickets.length, 1);
    assertEquals(tickets[0]!["app"], world.appId);
    assertEquals(tickets[0]!["readiness"], "ready");
    assertEquals(
      count(
        world.server,
        "select count(*) as n from ticket_adoption_questions",
      ),
      1,
    );
    assertEquals(count(world.server, APPROVALS), 0);
  } finally {
    await world.dispose();
  }
});
