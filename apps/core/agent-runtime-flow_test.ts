// lophn-agent/harness/run-loop: 실제 core(임시 LOPHN_HOME, 실제 ledger)에서 사람이 보낸 요청이 접수된 run이
// selector의 선택 → StartRun과 agent credential 발급(감독 pipe 메시지를 core 쪽 발급이 core 기록과
// 대조) → model call 하나(실제 HTTP로 fake provider) → tool call 하나(판정·진입·종료 기록) → 답
// 기록 → FinishRun으로 흐르는지 본다. 실제 provider와 사람 데이터 root는 열지 않는다.
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
import { createLedgerRegistration as documentsRegistration } from "./documents.ts";
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
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const SES = "ses_01arz3ndektsv4rrffq69g5fav";
const MSG = "msg_01arz3ndektsv4rrffq69g5fav";

const USER_OPERATIONS = [
  "ListAssignments",
  "OpenSession",
  "ReadSession",
  "ReceiveMessage",
  "RegisterProvider",
  "ReadModelDefaults",
  "ChangeModelDefaults",
  "project.create",
  "ReadRun",
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

Deno.test("lophn-agent/harness/run-loop#R8: 접수된 run이 selector 선택부터 model call 하나·tool call 하나를 거쳐 실제 ledger에서 완료로 끝난다", async () => {
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
    teams: [
      { lophnAgentDefinitions, createLedgerRegistration },
      { createLedgerRegistration: documentsRegistration },
    ],
    teamModules: [
      new URL("./lophn-agent.ts", import.meta.url).href,
      new URL("./documents.ts", import.meta.url).href,
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
    // lophn이 쓸 model은 Workspace의 role slot이 정한다(catalog에 있는 이름이어야 한다).
    const defaults = await call(
      server,
      "agent-model-defaults/read",
      USER_TOKEN,
      {},
    );
    const seq = (defaults.body["defaults"] as { settings_seq: string })
      .settings_seq;
    const chosen = await call(
      server,
      "agent-model-defaults/change",
      USER_TOKEN,
      command({
        lophn: {
          provider: PVD,
          model_name: "claude-sonnet-4-5",
          option_values: {},
        },
      }, { compare: { settings_seq: seq } }),
    );
    assertEquals(chosen.status, 200, JSON.stringify(chosen.body));
    const listed = await call(server, "assignments/list", MACHINE_TOKEN, {});
    const lophn = (listed.body["assignments"] as {
      id: string;
      role: string;
      revision: number;
    }[]).find((entry) => entry.role === "lophn");
    assert(lophn !== undefined);
    // 세션은 쓸 수 있는 project 하나를 자리로 받는다.
    const project = await call(
      server,
      "projects/create",
      USER_TOKEN,
      command({
        id: PROJECT,
        name: "alpha",
        title: "alpha",
        purpose: "",
        folders: [],
        tracking: { enabled: false, patterns: [], use_gitignore: false },
      }),
    );
    assertEquals(project.status, 200, JSON.stringify(project.body));
    const opened = await call(
      server,
      "sessions/open",
      USER_TOKEN,
      command({
        id: SES,
        assignment: lophn.id,
        work_place: { kind: "project", id: PROJECT },
        opening_context: null,
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

    // ledger: run은 완료, model call 둘, tool call 하나(판정 allow, 성공), 답 메시지 하나.
    const row = inspect(
      server,
      "select state, outcome_kind, outcome_reason from runs where id = ?",
      [run],
    )[0]!;
    assertEquals(row["state"], "finished");
    assertEquals(row["outcome_kind"], "completed");
    assertEquals(
      count(
        server,
        "select count(*) as n from model_calls where state = 'finished' and run = '" +
          run + "'",
      ),
      2,
    );
    const tools = inspect(
      server,
      "select tool, state, json_extract(decision, '$.decision') as verdict, json_extract(outcome, '$.kind') as kind from tool_calls where run = ?",
      [run],
    );
    assertEquals(tools.length, 1);
    assertEquals(tools[0]!["tool"], "project.list");
    assertEquals(tools[0]!["verdict"], "allow");
    assertEquals(tools[0]!["kind"], "success");

    // 기록은 preset이 아니라 run 기준이 고정한 agent hash를 가리킨다.
    const basisHash = String(
      inspect(server, "select basis from runs where id = ?", [run])[0]![
        "basis"
      ],
    );
    const basisBytes = await Deno.readFile(
      `${core.dataRoot}/blobs/sha256/${basisHash.slice(0, 2)}/${
        basisHash.slice(2)
      }`,
    );
    const pinned = (JSON.parse(new TextDecoder().decode(basisBytes)) as {
      agent: { hash: string };
    }).agent.hash;
    assertEquals(pinned.length, 64);
    const calls = inspect(
      server,
      "select agent_hash from model_calls where run = ?",
      [run],
    );
    assertEquals(calls.map((call) => call["agent_hash"]), [pinned, pinned]);
    assertEquals(
      inspect(
        server,
        "select json_extract(decision, '$.agent_hash') as hash, json_extract(decision, '$.session_grant') as grant from tool_calls where run = ?",
        [run],
      ),
      [{ hash: pinned, grant: null }],
    );
    assertEquals(
      count(
        server,
        "select count(*) as n from messages where actor like 'agent:%'",
      ),
      1,
    );
    // credential은 시작 뒤 한 번 발급되고 run이 끝나면 끝낸다.
    assertEquals(pipe.map((message) => message.type), [
      "agent_credential_request",
      "agent_credential_end",
    ]);
    // 두 번째 model 요청에는 첫 응답의 tool 결과가 들어 있다.
    const requests = provider.requests();
    assertEquals(requests.length, 2);
    assert(JSON.stringify(requests[1]!.body).includes("tool_result"));

    // 기록이 가리키는 hash는 모두 저장된 blob이다: 영구 참조가 있고 저장소의 바이트가 hash·크기와 맞는다.
    const refs = inspect(
      server,
      "select owner_kind, owner_key, field, hash, size_bytes from blob_refs where owner_kind in ('run', 'model_call', 'tool_call')",
      [],
    );
    const byOwner = (owner: string, field: string) =>
      refs.filter((ref) =>
        ref["owner_kind"] === owner && ref["field"] === field
      );
    assertEquals(byOwner("run", "basis").length, 1);
    // run이 시작할 때 고정한 resolved agent도 영구 참조다.
    assertEquals(byOwner("run", "agent").length, 1);
    assertEquals(byOwner("run", "result").length, 1);
    assertEquals(byOwner("model_call", "input").length, 2);
    assertEquals(byOwner("model_call", "context_basis").length, 2);
    assertEquals(byOwner("model_call", "output").length, 2);
    assertEquals(byOwner("tool_call", "input").length, 1);
    assertEquals(byOwner("tool_call", "output").length, 1);
    assertEquals(refs.length, 11);
    for (const ref of refs) {
      const hash = String(ref["hash"]);
      const bytes = await Deno.readFile(
        `${core.dataRoot}/blobs/sha256/${hash.slice(0, 2)}/${hash.slice(2)}`,
      );
      assertEquals(bytes.length, Number(ref["size_bytes"]));
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes),
      );
      assertEquals(
        Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
          "",
        ),
        hash,
      );
    }
    // 열에 남은 hash가 곧 그 참조의 hash다.
    const hashes = new Set(
      refs.map((ref) => `${ref["owner_key"]}/${ref["field"]}/${ref["hash"]}`),
    );
    const column = (
      sql: string,
      owner: string,
      field: string,
      params: string[],
    ) => {
      for (const row of inspect(server, sql, params)) {
        assert(
          hashes.has(`${row["id"]}/${field}/${row["value"]}`),
          `${owner}.${field} ${row["id"]}`,
        );
      }
    };
    column("select id, basis as value from runs where id = ?", "run", "basis", [
      run,
    ]);
    column(
      "select id, result as value from runs where id = ?",
      "run",
      "result",
      [run],
    );
    column(
      "select id, input as value from model_calls where run = ?",
      "model_call",
      "input",
      [run],
    );
    column(
      "select id, context_basis as value from model_calls where run = ?",
      "model_call",
      "context_basis",
      [run],
    );
    column(
      "select id, output as value from model_calls where run = ?",
      "model_call",
      "output",
      [run],
    );
    column(
      "select id, input as value from tool_calls where run = ?",
      "tool_call",
      "input",
      [run],
    );
    column(
      "select id, output as value from tool_calls where run = ?",
      "tool_call",
      "output",
      [run],
    );
  } finally {
    await provider.close();
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
