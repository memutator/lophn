// lophn-agent#T37: flow add-agent-extension의 agent 갈래다(docs/flows/add-agent-extension.md).
// 실제 core(임시 LOPHN_HOME, 실제 ledger)에서 사람이 MCP server를 등록하고(settings/apply),
// 제품 기본 preset에 MCP 선택을 얹은 user preset을 만들고(presets/create), assignment의 preset을
// 바꾼 뒤(assignments/change-preset), 접수된 run이 external MCP tool을 통해
// 가짜 stdio MCP child를 부르는지 본다. 사람의 실제 registry·실제 MCP server·실제 model
// provider에 닿지 않는다.
import { assert, assertEquals } from "@std/assert";
import { createHash } from "node:crypto";
import {
  createIdSource,
  err,
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
import { createMcpToolkit } from "../agent-runtime/mcp-toolkit.ts";
import {
  type McpConnectionsDeps,
  spawnStdioMcp,
  type StdioSpawnInput,
} from "../../packages/lophn-agent/extensions/mod.ts";
import {
  mcpToolDefinitionHash,
  type McpToolEntry,
} from "../../packages/lophn-agent/extensions/mod.ts";
import { mcpServersSetting } from "../../packages/contracts/lophn-agent/mod.ts";
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
  inspect,
  type Server,
} from "./testing/approvals-fixture.ts";
import { MACHINE_TOKEN, USER_TOKEN } from "./testing/tool-judgment-world.ts";

const PVD = "pvd_01arz3ndektsv4rrffq69g5fav";
const SES = "ses_01arz3ndektsv4rrffq69g5fav";
const MSG = "msg_01arz3ndektsv4rrffq69g5fav";

// run이 제공하는 tool의 contract다. user 자격의 scope에도 들어 있다. 답 기록은
// run이 끝나는 길이라(supporting operation) 같이 준다.
const AGENT_OPERATIONS = [
  "external_mcp_call",
  "create_approval_request",
  "ReadToolCall",
  "RecordMessage",
];

const USER_OPERATIONS = [
  "ListAssignments",
  "OpenSession",
  "ReadSession",
  "ReceiveMessage",
  "RegisterProvider",
  "CreatePreset",
  "ChangeAssignmentPreset",
  "ReadAssignment",
  "SettingsDefinitions",
  "GetSettings",
  "ApplySettings",
];

const MACHINE_OPERATIONS = [
  ...new Set(RUNTIME_MACHINE_ROUTES.map((route) => route.name)),
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

// ---- 가짜 MCP stdio child ----
// tools read_note·write_note·scan_note를 알려준다. read_note는 분류(read·safe)가 있고
// write_note는 분류(external)가 있으며 scan_note는 미분류다. 호출은 받은 입력을 그대로 되돌려
// 서버에 원래 이름과 입력이 닿았는지 본다.
const MCP_CHILD = `\
const dec = new TextDecoder();
let buf = "";
for (;;) {
  const chunk = new Uint8Array(4096);
  const n = await Deno.stdin.read(chunk);
  if (n === null) break;
  buf += dec.decode(chunk.subarray(0, n));
  for (;;) {
    const at = buf.indexOf("\\n");
    if (at < 0) break;
    const line = buf.slice(0, at);
    buf = buf.slice(at + 1);
    if (line.trim() === "") continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.method === "initialize") {
      await Deno.stdout.write(new TextEncoder().encode(JSON.stringify({
        jsonrpc: "2.0", id: message.id,
        result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "0" } },
      }) + "\\n"));
      continue;
    }
    if (message.method === "tools/list") {
      const tool = (name) => ({ name, description: name + " desc", inputSchema: { type: "object", properties: { id: { type: "string" } } } });
      await Deno.stdout.write(new TextEncoder().encode(JSON.stringify({
        jsonrpc: "2.0", id: message.id, result: { tools: [tool("read_note"), tool("write_note"), tool("scan_note")] },
      }) + "\\n"));
      continue;
    }
    if (message.method === "tools/call") {
      await Deno.stdout.write(new TextEncoder().encode(JSON.stringify({
        jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "mcp-ok:" + message.params.name + ":" + JSON.stringify(message.params.arguments) }] },
      }) + "\\n"));
      continue;
    }
  }
}
`;

const NOTE_SCHEMA = {
  type: "object",
  properties: { id: { type: "string" } },
};

let childPath: string | undefined;

async function writeChild(): Promise<string> {
  const home = await Deno.makeTempDir({ prefix: "lophn-mcp-flow-" });
  const path = `${home}/fake-mcp-child.mjs`;
  await Deno.writeTextFile(path, MCP_CHILD);
  return path;
}

// ---- preset 판 fixture ----
// 제품 기본 preset에 MCP 선택을 얹은 user 판이다. 고른 정확한 쌍만 선택한다(R31: 서버 전체
// 선택은 없다). read_note는 분류(read·reversible)와 safe 표시가 있고 scan_note는 미분류이며
// write_note는 어느 시나리오에서도 선택 밖이라 정의도 호출도 없다.
function userPresetDefinition(
  prompt: string,
  selected: readonly string[],
  safe: readonly string[],
) {
  return {
    kind: "lophn",
    name: "MCP review",
    origin: "user",
    prompt,
    capability: { bundles: [], tools: [] },
    context: [{ kind: "all", target: null, section: null }],
    mcp: {
      servers: ["notes"],
      tools: selected.map((original_tool) => ({
        server_name: "notes",
        original_tool,
      })),
    },
    safe_tools: safe.map((original_tool) => ({
      server_name: "notes",
      original_tool,
    })),
    skills: [],
    // model 선택은 없다. provider ledger 검사(providers 표·credential 확인)를
    // 건너뛴다(presets/capability validateModelSelection). run이 쓸 model은 이
    // 테스트의 resolveModel stub이 낸다.
    model: null,
    organizing_model: null,
    instructions: [],
  };
}

type ScenarioEnd = {
  run: string;
  end: unknown;
  server: Server;
  provider: ReturnType<typeof startFakeProvider>;
};

type Scenario = {
  // 첫 model 응답이 부르는 tool(호출 이름과 입력)이다.
  call: { name: string; arguments: string };
  selected: readonly string[];
  safe: readonly string[];
  // 호출 뒤 model이 낼 답이 있으면 둘째 단계를 둔다.
  answer: boolean;
  verify(result: ScenarioEnd): void | Promise<void>;
};

async function runScenario(scenario: Scenario): Promise<void> {
  const home = await Deno.makeTempDir({ prefix: "lophn-mcp-ext-flow-" });
  const clock = manualClock(Date.UTC(2024, 0, 1));
  childPath = await writeChild();
  const provider = startFakeProvider({
    script: {
      steps: [
        {
          id: "ask",
          protocol: "messages",
          reply: {
            text: "I will use the tool.",
            toolCalls: [{
              id: "toolu_1",
              name: scenario.call.name,
              arguments: scenario.call.arguments,
            }],
            usage: { input: 20, output: 8 },
            stop: "tool_calls",
          },
        },
        ...(scenario.answer
          ? [{
            id: "answer",
            protocol: "messages" as const,
            reply: {
              text: "The note is read.",
              usage: { input: 40, output: 9 },
              stop: "end" as const,
            },
          }]
          : []),
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
    confirmation: (body) =>
      Promise.resolve(
        core.confirmation?.(body as never) as never,
      ),
  };
  try {
    const accept = async (ctx: AuthenticatedContext, token: string) => {
      const accepted = await core.acceptTestCredential?.(ctx, token);
      assert(accepted?.ok, JSON.stringify(accepted));
      assert((await core.record(ctx)).ok);
    };
    await accept(context("machine", MACHINE_OPERATIONS), MACHINE_TOKEN);
    await accept(context("user", USER_OPERATIONS), USER_TOKEN);

    // 사람의 registry 출처다(R11): MCP server 설정을 settings/apply로 심는다.
    const definitions = await call(server, "settings/definitions", USER_TOKEN, {
      keys: [mcpServersSetting.key],
    });
    assertEquals(definitions.status, 200, JSON.stringify(definitions.body));
    const defaultsRevision = (definitions.body as { defaults_revision: string })
      .defaults_revision;
    const applied = await call(
      server,
      "settings/apply",
      USER_TOKEN,
      {
        input: {
          changes: [{
            layer: "common",
            key: mcpServersSetting.key,
            action: "set",
            value: [{
              name: "notes",
              revision: 1,
              enabled: true,
              transport: "stdio",
              call_timeout_ms: 60_000,
              classifications: {
                read_note: {
                  effect: "read",
                  reversible: true,
                  // schema_hash는 사람이 등록 화면에서 본 현재 정의 hash다. run이
                  // 정의를 만든 뒤 계산하는 hash와 같아야 한다(R24). 정의 hash는
                  // mcpToolDefinitionHash(원본 정의의 name·description·schema·hints).
                  schema_hash: await mcpToolDefinitionHash(
                    {
                      server: "notes",
                      original: "read_note",
                      description: "read_note desc",
                      schema: NOTE_SCHEMA,
                    } satisfies McpToolEntry,
                  ),
                },
                write_note: {
                  effect: "external",
                  reversible: false,
                  schema_hash: await mcpToolDefinitionHash(
                    {
                      server: "notes",
                      original: "write_note",
                      description: "write_note desc",
                      schema: NOTE_SCHEMA,
                    } satisfies McpToolEntry,
                  ),
                },
                // 정의 hash가 맞지 않는 옛 분류다. 현재 정의에는 분류가 없는 것과 같다(R24, R28).
                scan_note: {
                  effect: "read",
                  reversible: true,
                  schema_hash: "0".repeat(64),
                },
              },
              stdio: {
                executable: "/bin/sh",
                args: [
                  "-c",
                  `deno run --allow-read --allow-env ${childPath} normal`,
                ],
                cwd: null,
                env: {},
              },
            }],
          }],
        },
        idempotency_key: "mcp-servers-apply-1",
        compare: { revision: 0, defaults_revision: defaultsRevision },
        prepared: [],
      },
    );
    assertEquals(applied.status, 200, JSON.stringify(applied.body));

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

    // assignment를 찾는다.
    const listed = await call(server, "assignments/list", MACHINE_TOKEN, {});
    const lophn = (listed.body["assignments"] as {
      id: string;
      role: string;
      revision: number;
    }[]).find((entry) => entry.role === "lophn");
    assert(lophn !== undefined);

    // 사람이 MCP 선택을 얹은 user preset을 만든다(presets/create).
    const prompt = createHash("sha256").update("user prompt", "utf8").digest(
      "hex",
    );
    const definition = userPresetDefinition(
      prompt,
      scenario.selected,
      scenario.safe,
    );
    const created = await call(
      server,
      "presets/create",
      USER_TOKEN,
      command({
        id: "pst_01arz3ndektsv4rrffq69g5fav",
        definition,
        copied_from: null,
      }),
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));

    // assignment의 preset을 바꾼다(CAS revision+role).
    const changed = await call(
      server,
      "assignments/change-preset",
      USER_TOKEN,
      command({
        assignment: lophn.id,
        preset: "pst_01arz3ndektsv4rrffq69g5fav",
        preset_revision: 1,
      }, {
        compare: { revision: lophn.revision, role: "lophn" },
      }),
    );
    assertEquals(changed.status, 200, JSON.stringify(changed.body));

    // session과 사람 요청 접수.
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
          assignment_revision: lophn.revision + 1,
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
          parts: [{ kind: "text", text: "Read the note." }],
        },
        mode: "request",
      }, {
        compare: {
          session_state: "open",
          session_state_seq:
            (session.body as { session: { state_seq: string } }).session
              .state_seq,
          assignment_revision: lophn.revision + 1,
          assignment_state: "enabled",
        },
      }),
    );
    assertEquals(sent.status, 200, JSON.stringify(sent.body));
    const run = (sent.body as { message: { run: string } }).message.run;

    // runtime 조립이다. mcp-toolkit과 credential pipe는 실제 조립과 같다.
    const machine = machineCall({
      port: core.port,
      credential: () => MACHINE_TOKEN,
    });
    const connsDeps: McpConnectionsDeps = {
      nowMs: () => clock.nowMs(),
      wait: () => Promise.resolve("elapsed" as const),
      deadline: async (ms, signal) => {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(ms, 10_000))
        );
        return signal.aborted ? "aborted" as const : "elapsed" as const;
      },
      openStdio: (_server: unknown, input: StdioSpawnInput) =>
        Promise.resolve(
          spawnStdioMcp({
            ...input,
            env: { ...input.env, FAKE_CHILD: childPath ?? "" },
          }),
        ),
    };
    const mcpKit = createMcpToolkit({
      machine,
      connections: connsDeps,
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
        handlers: () => new Map(),
        // 외부 MCP tool 등록 통로다(T37). 실제 조립과 같은 자리다.
        mcp: (assignment: string) => mcpKit.toolkit(assignment),
      },
      product: "PRODUCT RULES",
      rolePrompt: () => Promise.resolve(ok("ROLE RULES")),
      instructions: {
        files: {
          registered: () => Promise.resolve(ok(null)),
          attached: () =>
            Promise.resolve(err({ code: "not_found", message: "none" })),
          projectOf: () => Promise.resolve(ok(null)),
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
    await scenario.verify({ run, end, server, provider });
  } finally {
    await provider.close();
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
}

const TOOL_CALL_ROWS =
  "select tool, state, effect, json_extract(extension, '$.server_name') as server_name, json_extract(extension, '$.configuration_revision') as configuration_revision, json_extract(extension, '$.original_tool') as original_tool, json_extract(extension, '$.canonical_name') as canonical_name from tool_calls where run = ?";

// 모든 model 요청이 고른 쌍만 `ext_` 이름으로 보여 주고 고르지 않은 tool은 어디에도 없다.
function assertOffered(
  provider: ReturnType<typeof startFakeProvider>,
  offered: string,
) {
  const requests = provider.requests();
  assert(requests.length >= 1);
  for (const request of requests) {
    const body = JSON.stringify(request.body);
    assert(body.includes(`"name":"${offered}"`), `${offered}가 요청에 없다`);
    assert(!body.includes("write_note"), "선택 밖 tool이 요청에 나왔다");
    assert(!body.includes("scan_note") || offered.includes("scan_note"));
    assert(!body.includes("read_note") || offered.includes("read_note"));
  }
}

Deno.test("lophn-agent/extensions#R11 #R23 #R29 #R31: flow add-agent-extension agent 갈래 — 사람이 고른 분류·safe 쌍은 확인 없이 원래 server·입력으로 가고 extension 쌍으로 기록된다", async () => {
  await runScenario({
    call: { name: "ext_notes_read_note", arguments: '{"id":"n1"}' },
    selected: ["read_note"],
    safe: ["read_note"],
    answer: true,
    verify({ run, end, server, provider }) {
      assertEquals(end, {
        kind: "finished",
        outcome: { kind: "completed", reason: "answer_completed" },
      });
      const row = inspect(
        server,
        "select state, outcome_kind from runs where id = ?",
        [run],
      )[0]!;
      assertEquals(row["state"], "finished");
      assertEquals(row["outcome_kind"], "completed");
      // 기록 확장이다(R23, R24): 원래 서버·tool 쌍, canonical 이름, 서버 설정 판.
      const tools = inspect(server, TOOL_CALL_ROWS, [run]);
      assertEquals(tools.length, 1);
      assertEquals(tools[0]!["tool"], "ext_notes_read_note");
      assertEquals(tools[0]!["state"], "finished");
      assertEquals(tools[0]!["server_name"], "notes");
      assertEquals(tools[0]!["original_tool"], "read_note");
      assertEquals(tools[0]!["canonical_name"], "ext_notes_read_note");
      assertEquals(tools[0]!["configuration_revision"], 1);
      assertEquals(provider.requests().length, 2);
      assertOffered(provider, "ext_notes_read_note");
      // 호출은 server에 원래 tool 이름과 입력 그대로 닿았다(R29): child가 되돌린 결과가
      // 두 번째 model 요청에 실려 있다.
      // 결과는 tool_result 안의 JSON 글이라 따옴표가 두 번 이스케이프된다.
      const text = 'mcp-ok:read_note:{"id":"n1"}';
      const inner = JSON.stringify(text).slice(1, -1);
      const echoed = JSON.stringify(inner).slice(1, -1);
      assert(
        JSON.stringify(provider.requests()[1]!.body).includes(echoed),
        "server가 받은 이름·입력이 결과에 없다",
      );
    },
  });
});

Deno.test("lophn-agent/extensions#R28 #R31: flow add-agent-extension agent 갈래 — 미분류 tool은 확인을 묻고 허락 전에는 server에 닿지 않는다", async () => {
  await runScenario({
    call: { name: "ext_notes_scan_note", arguments: '{"id":"n1"}' },
    selected: ["scan_note"],
    safe: [],
    answer: false,
    verify({ run, end, server, provider }) {
      assertEquals((end as { kind: string }).kind, "waiting");
      // 호출은 시작되지 않고 approval request가 하나 생겼다(R28). child는 불리지 않았다.
      const approvals = inspect(
        server,
        "select count(*) as n from approval_requests",
        [],
      );
      assertEquals(approvals[0]!["n"], 1);
      const tools = inspect(server, TOOL_CALL_ROWS, [run]);
      assertEquals(tools.length, 1);
      assertEquals(tools[0]!["tool"], "ext_notes_scan_note");
      assertEquals(tools[0]!["effect"], "external");
      assertEquals(tools[0]!["original_tool"], "scan_note");
      assertEquals(tools[0]!["state"], "requested");
      assertOffered(provider, "ext_notes_scan_note");
    },
  });
});
