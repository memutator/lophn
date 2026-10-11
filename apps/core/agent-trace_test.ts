// lophn-agent/observability: 실제 core(임시 LOPHN_HOME, 실제 ledger)에서 agent turn 하나(model call 둘, tool call
// 하나, 답 하나)를 fake provider로 돌린 뒤 trace를 읽는다. trace는 저장하지 않고 ledger의 run·event·call·message
// 참조에서 조립된다. 실제 provider와 사람 데이터 root는 열지 않는다.
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
import { startFakeProvider } from "../../tools/fake-provider/mod.ts";
import { createCredentialLink } from "../agent-runtime/credential-link.ts";
import {
  agentCall,
  machineCall,
  RUNTIME_MACHINE_ROUTES,
} from "../agent-runtime/core-http.ts";
import { anthropicPacker } from "../agent-runtime/model-binding.ts";
import { createRunPreparer } from "../agent-runtime/prepare.ts";
import { createRunDriver } from "../agent-runtime/run-driver.ts";
import { createAgentCredentialLink } from "./agent-credentials.ts";
import { startCore } from "./core.ts";
import {
  createLedgerRegistration,
  lophnAgentDefinitions,
} from "./lophn-agent.ts";
import {
  call,
  command,
  count,
  inspect,
  type Server,
} from "./testing/approvals-fixture.ts";
import { MACHINE_TOKEN, USER_TOKEN } from "./testing/tool-judgment-world.ts";

const PVD = "pvd_01arz3ndektsv4rrffq69g5fav";
const SES = "ses_01arz3ndektsv4rrffq69g5fav";
const MSG = "msg_01arz3ndektsv4rrffq69g5fav";

const USER_OPERATIONS = [
  "ListAssignments",
  "OpenSession",
  "ReadSession",
  "ReceiveMessage",
  "RegisterProvider",
  "ReadRun",
  "ReadAgentTrace",
];
const AGENT_OPERATIONS = [
  "RecordMessage",
  "ReadToolCall",
  "create_approval_request",
  "ReadApprovalText",
  "ListProjects",
  "workspace.read",
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

Deno.test("lophn-agent/observability#R1: 실제 core에서 돌린 agent turn의 trace는 저장 없이 ledger 참조에서 조립되고 범위 밖 대상은 없는 대상과 같다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-runtime-flow-" });
  const clock = manualClock(Date.UTC(2024, 0, 1));
  const provider = startFakeProvider({
    script: {
      steps: [
        {
          id: "ask",
          protocol: "messages",
          reply: {
            text: "I will look at the projects.",
            toolCalls: [{
              id: "toolu_1",
              name: "project.list",
              arguments: "{}",
            }],
            usage: { input: 20, output: 8 },
            stop: "tool_calls",
          },
        },
        {
          id: "answer",
          protocol: "messages",
          reply: {
            text: "There are no projects yet.",
            usage: { input: 40, output: 9 },
            stop: "end",
          },
        },
      ],
    },
    nowMs: () => clock.nowMs(),
    instant: true,
  });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ lophnAgentDefinitions, createLedgerRegistration }],
    teamModules: [new URL("./lophn-agent.ts", import.meta.url).href],
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
    confirmation: () =>
      Promise.resolve({ ok: false as const, error: { message: "none" } }),
  };
  try {
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

    // provider 등록과 사람 요청 접수.
    const registered = await call(
      server,
      "providers/register",
      USER_TOKEN,
      command({
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
      }),
    );
    assertEquals(registered.status, 200, JSON.stringify(registered.body));
    const listed = await call(server, "assignments/list", MACHINE_TOKEN, {});
    const lophn = (listed.body["assignments"] as {
      id: string;
      role: string;
      revision: number;
    }[]).find((entry) => entry.role === "lophn");
    assert(lophn !== undefined);
    const opened = await call(
      server,
      "sessions/open",
      USER_TOKEN,
      command({
        id: SES,
        assignment: lophn.id,
        role: "lophn",
        work_place: { kind: "global", id: null },
        continued_from: null,
      }, {
        compare: {
          assignment_revision: lophn.revision,
          assignment_state: "enabled",
        },
      }),
    );
    assertEquals(opened.status, 200, JSON.stringify(opened.body));
    const session = await call(server, "sessions/read", USER_TOKEN, {
      session: SES,
    });
    const sent = await call(
      server,
      "messages/receive",
      USER_TOKEN,
      command({
        id: MSG,
        session: SES,
        content: {
          schema_version: 1,
          parts: [{ kind: "text", text: "What projects exist?" }],
        },
        mode: "request",
      }, {
        compare: {
          session_state: "open",
          session_state_seq:
            (session.body as { session: { state_seq: string } }).session
              .state_seq,
          assignment_revision: lophn.revision,
          assignment_state: "enabled",
        },
      }),
    );
    assertEquals(sent.status, 200, JSON.stringify(sent.body));
    const run = (sent.body as { message: { run: string } }).message.run;

    // runtime 쪽 조립. 감독 pipe는 core 쪽 발급을 직접 부른다.
    const machine = machineCall({
      port: core.port,
      credential: () => MACHINE_TOKEN,
    });
    let sequence = 0;
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
    const pipe: ChildMessage[] = [];
    const link: ReturnType<typeof createCredentialLink> = createCredentialLink({
      async send(message) {
        pipe.push(message);
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

    const model: CallModel = {
      provider: PVD,
      name: "fixture-model",
      protocol: "anthropic-messages",
      credential_key: null,
      credential_revision: null,
      options: {},
      requested_reasoning: null,
      applied_reasoning: null,
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
    const ids = createIdSource({ clock, random: seededRandom(99) });
    const preparer = createRunPreparer({
      clock,
      ids,
      machine,
      // 감독 pipe의 blob 준비를 대신한다. 준비 주체는 machine credential의 principal이다.
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
      resolveModel: ({ preset }) =>
        Promise.resolve(ok({
          call: model,
          preset,
          endpoint: provider.url,
          usageRevision: "usage-1",
          timeoutMs: 20_000,
          pack: anthropicPacker({ model: model.name, maxTokens: 4096 }),
          invoke,
          available: () => Promise.resolve(true),
        })),
      toolkit: {
        binding: () => undefined,
        handlers: () =>
          new Map([[
            "project.list",
            () =>
              Promise.resolve(ok({
                status: "success" as const,
                summary: "No projects.",
                content: { projects: [] },
                complete: true,
                source: null,
                continuation: null,
                pending: [],
              })),
          ]]),
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

    const result = await driver.startNext();
    assert(result.kind === "started", JSON.stringify(result));
    assertEquals(result.run, run);
    const end = await result.done;
    assertEquals(end, {
      kind: "finished",
      outcome: { kind: "completed", reason: "answer_completed" },
    });

    // trace: run·event·호출·메시지의 원본 참조를 seq 순으로 조립한다. 저장한 trace 표는 없다.
    const read = await call(server, "agent-traces/read", USER_TOKEN, {
      target: { kind: "run", run },
    });
    assertEquals(read.status, 200, JSON.stringify(read.body));
    const trace = (read.body as { trace: Record<string, unknown> }).trace;
    assertEquals(trace["run"], run);
    assertEquals(trace["state"], "finished");
    assertEquals(trace["reason"], {
      kind: "completed",
      reason: "answer_completed",
    });
    assertEquals(trace["missing"], []);
    const row = inspect(
      server,
      "select basis, assignment from runs where id = ?",
      [
        run,
      ],
    )[0]!;
    assertEquals(trace["basis"], row["basis"]);
    assertEquals(trace["assignment"], row["assignment"]);
    const calls = inspect(
      server,
      "select id from model_calls where run = ? order by attempt_order",
      [run],
    ).map((entry) => entry["id"]);
    assertEquals(calls.length, 2);
    assertEquals(trace["model_calls"], calls);
    const tools = inspect(server, "select id from tool_calls where run = ?", [
      run,
    ]).map((entry) => entry["id"]);
    assertEquals(trace["tool_calls"], tools);
    const seqs = (trace["events"] as string[]).map(Number);
    assert(seqs.length >= 4);
    assertEquals(seqs, [...seqs].sort((a, b) => a - b));
    assert((trace["messages"] as string[]).includes(MSG));
    assertEquals(
      trace["messages"],
      inspect(
        server,
        "select id from messages where run = ? order by created_seq",
        [run],
      ).map((entry) => entry["id"]),
    );
    const times = trace["times"] as Record<string, number | null>;
    for (const value of Object.values(times)) assert((value ?? 0) >= 0);
    assertEquals(times["waiting_ms"], 0);
    assertEquals(
      (trace["activity"] as { tools: { succeeded: number } }).tools.succeeded,
      1,
    );
    assertEquals(
      count(
        server,
        "select count(*) as n from sqlite_master where name like '%trace%'",
      ),
      0,
    );

    // 범위 밖 대상(역할 불일치·없는 run)은 없는 run과 똑같이 답한다.
    const absent = await call(server, "agent-traces/read", USER_TOKEN, {
      target: { kind: "run", run: "run_01arz3ndektsv4rrffq69g5faw" },
    });
    const wrongRole = await call(server, "agent-traces/read", USER_TOKEN, {
      target: { kind: "run", run },
      role: "operator",
    });
    assertEquals(absent.status, 404);
    assertEquals(wrongRole.status, absent.status);
    assertEquals(
      wrongRole.body["error"] as { code: string; message: string },
      absent.body["error"] as { code: string; message: string },
    );

    // session 대상은 그 session의 run을 한 묶음으로 낸다.
    const folded = await call(server, "agent-traces/read", USER_TOKEN, {
      target: { kind: "session", session: SES },
    });
    assertEquals(folded.status, 200, JSON.stringify(folded.body));
    assertEquals(
      (folded.body as { trace: { model_calls: string[] } }).trace.model_calls,
      calls,
    );
  } finally {
    await provider.close();
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
