/**
 * tool 판정 시험이 같이 쓰는 준비. 실제 core(임시 LOPHN_HOME, 실제 ledger)를 띄우고 lophn-agent의
 * run·assignment와 시험 전용 소유 command(approval-owner)를 함께 등록한다. model 쪽은 실제 HTTP로 fake
 * provider를 불러 tool 요청을 받는다. 실제 provider와 사람 데이터 root는 열지 않는다. 제품 main.ts에는 없다.
 */
import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import {
  createIdSource,
  err,
  fingerprint,
  type IdSource,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../../packages/base/mod.ts";
import type {
  AuthenticatedContext,
  JsonObject,
} from "../../../packages/contracts/platform/mod.ts";
import {
  createAuthTransport,
  type SecretAttachLike,
} from "../../../packages/lophn-agent/harness/provider/adapters/auth-transport.ts";
import { createFetchTransport } from "../../../packages/lophn-agent/harness/provider/adapters/transport.ts";
import { createInvokeModelCall } from "../../../packages/lophn-agent/harness/provider/invoke.ts";
import type { ModelCallInput } from "../../../packages/lophn-agent/harness/provider/work.ts";
import {
  type CoreCall,
  createToolJudgment,
  type JudgmentDeps,
  type ResolvedAction,
  type Reversibility,
  type ToolBinding,
} from "../../../packages/lophn-agent/harness/tool-judgment/mod.ts";
import type { ToolDefinition } from "../../../packages/lophn-agent/harness/tools/mod.ts";
import { startFakeProvider } from "../../../tools/fake-provider/mod.ts";
import { type Core, startCore } from "../core.ts";
import { lophnAgentDefinitions } from "../lophn-agent.ts";
import * as approvalOwner from "./approval-owner.ts";
import {
  call,
  command,
  count,
  inspect,
  type Reply,
  type Server,
} from "./approvals-fixture.ts";

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
export function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

export const MACHINE_TOKEN = "b".repeat(43);
export const USER_TOKEN = "e".repeat(43);
export const MSG_ONE = id("msg", 1);
export const MSG_TWO = id("msg", 2);
export const RUN_A = id("run", 1);
export const RUN_B = id("run", 2);
export const RUN_C = id("run", 3);
export const TARGET = "doc_01h455vb4pex5v6nkc6gd5fdw1";
export const OTHER_TARGET = "doc_01h455vb4pex5v6nkc6gd5fdw2";
export const OUTSIDE = "doc_01h455vb4pex5v6nkc6gd5fdw9";
export const APPROVALS = "select count(*) as n from approval_requests";
export const NOTES =
  "select count(*) as n from events where type = 'OwnedNoteRecorded'";
export const USES = "select count(*) as n from approval_uses";
// run 기준이 고정한 resolved agent의 지문 자리다. 판정 기록과 session 허락 비교가 이 값을 쓴다.
export const AGENT_HASH = "ab".repeat(32);
export const QUESTIONS = "select count(*) as n from questions";

const MACHINE_OPERATIONS = [
  "ListAssignments",
  "AcceptRun",
  "ReadRun",
  "ReadAssignment",
  "RecordToolRequest",
  "DecideToolCall",
  "StartToolCall",
  "FinishToolCall",
  "ReadToolCall",
  "ListApprovals",
  "GetApproval",
  "ReadApprovalText",
  "apply_approved_action",
  "expire_approval_request",
  "record_owned_note",
  "PauseAssignment",
];

type Assignment = { id: string; role: string; revision: number };
export type RunKey = "a" | "b" | "c";

export type World = {
  core: Core;
  server: Server;
  clock: ReturnType<typeof manualClock>;
  lophn: Assignment;
  editor: Assignment;
  runs: Record<RunKey, { run: string; assignment: Assignment; token: string }>;
  machine: CoreCall;
  ids: IdSource;
  post(
    path: string,
    token: string,
    input: unknown,
    compare?: unknown,
  ): Promise<Reply>;
  read(path: string, token: string, input: unknown): Promise<Reply>;
  // 테스트 시계는 writer와 공유되지 않아 민 시각을 core에 알려야 한다.
  advance(ms: number): Promise<void>;
  dispose(): Promise<void>;
};

function context(
  actor: string,
  operations: string[],
  targets: Record<string, string> = {},
): AuthenticatedContext {
  return {
    principal: actor,
    actor,
    scope: { operations, targets },
    conditions: targets,
    credential_ref: `cred-${actor}-${targets["run"] ?? "none"}`,
  } as AuthenticatedContext;
}

async function accept(
  core: Core,
  credential: AuthenticatedContext,
  token: string,
) {
  const accepted = await core.acceptTestCredential?.(credential, token);
  assert(accepted?.ok);
  const recorded = await core.record(credential);
  assert(recorded.ok);
}

export function coreCall(server: Server, token: string): CoreCall {
  return async (path: string, body: unknown): Promise<Result<unknown>> => {
    const reply = await call(server, path.replace(/^\/v1\//, ""), token, body);
    if (reply.status === 200) return ok(reply.body);
    const error = reply.body["error"] as
      | { code?: string; message?: string; details?: Record<string, unknown> }
      | undefined;
    return err({
      code: (error?.code ?? "internal") as "internal",
      message: error?.message ?? "core error",
      ...(error?.details === undefined ? {} : { details: error.details }),
    });
  };
}

// 같은 사람 요청(MSG_ONE)에서 시작한 run A, 그 요청에서 handoff로 이어진 다른 assignment의 run B,
// 다른 사람 요청(MSG_TWO)의 run C. 모두 실제 AcceptRun으로 접수하고 run마다 agent 자격을 묶는다.
export async function openWorld(): Promise<World> {
  const home = await Deno.makeTempDir({ prefix: "lophn-tool-judgment-" });
  const clock = manualClock(Date.UTC(2024, 0, 1));
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ lophnAgentDefinitions }, approvalOwner],
    teamModules: [
      new URL("../lophn-agent.ts", import.meta.url).href,
      new URL("./approval-owner.ts", import.meta.url).href,
    ],
    clock,
    random: seededRandom(41),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  const server: Server = {
    port: core.port,
    dataRoot: core.dataRoot,
    clock,
    confirmation: (body) =>
      core.confirmation?.(body) ??
        Promise.resolve({ ok: false as const, error: { message: "없다" } }),
  };
  await accept(core, context("machine", MACHINE_OPERATIONS), MACHINE_TOKEN);
  await accept(
    core,
    context("user", [
      "reject_approval_request",
      "grant_approval_request",
      "GetApproval",
      "ListApprovals",
      "ReadApprovalText",
      "PauseAssignment",
    ]),
    USER_TOKEN,
  );
  const machine = coreCall(server, MACHINE_TOKEN);
  const ids = createIdSource({ clock, random: seededRandom(77) });
  const post = (
    path: string,
    token: string,
    input: unknown,
    compare: unknown = {},
  ) => call(server, path, token, command(input, { compare }));
  const listed = await call(server, "assignments/list", MACHINE_TOKEN, {});
  assertEquals(listed.status, 200, JSON.stringify(listed.body));
  const assignments = listed.body["assignments"] as Assignment[];
  const lophn = assignments.find((entry) => entry.role === "lophn");
  const editor = assignments.find((entry) => entry.role === "context_engineer");
  assert(lophn && editor);
  const plan = [
    ["a", lophn, RUN_A, { kind: "message", message: MSG_ONE }],
    ["b", editor, RUN_B, {
      kind: "handoff",
      sender_run: RUN_A,
      original_message: MSG_ONE,
      body: "c".repeat(64),
      references: [],
      dedup_key: "handoff-one",
    }],
    ["c", lophn, RUN_C, { kind: "message", message: MSG_TWO }],
  ] as const;
  const runs = {} as World["runs"];
  for (const [key, assignment, run, source] of plan) {
    const accepted = await post("runs/accept", MACHINE_TOKEN, {
      id: run,
      assignment: assignment.id,
      session: null,
      source,
      continued_from: null,
      start_after: null,
    }, { assignment_revision: assignment.revision });
    assertEquals(accepted.status, 200, JSON.stringify(accepted.body));
    const token = `x${key.repeat(42)}`;
    await accept(
      core,
      context(`agent:${assignment.id}`, [
        "create_approval_request",
        "ReadApprovalText",
      ], {
        assignment: assignment.id,
        run,
      }),
      token,
    );
    runs[key] = { run, assignment, token };
  }
  return {
    core,
    server,
    clock,
    lophn,
    editor,
    runs,
    machine,
    ids,
    post,
    read: (path, token, input) => call(server, path, token, input),
    async advance(ms) {
      clock.advance(ms);
      await core.sweepTicketClaims();
    },
    async dispose() {
      await core.shutdown();
      await Deno.remove(home, { recursive: true });
    },
  };
}

// 시험 tool. 입력은 소유 command `record_owned_note`의 입력과 같다. tool 하나는 소유 계약의
// 호출 하나다.
const noteInput = z.strictObject({ note: z.string().min(1) });

export function tool(
  name: string,
  over: Partial<ToolDefinition> = {},
): ToolDefinition {
  return {
    name,
    description: `${name} test tool`,
    revision: "1",
    input: noteInput,
    effect: "write",
    confirm: false,
    contract: "record_owned_note",
    scopeCheck: "target",
    reversible: false,
    idempotent: false,
    errors: [],
    origin: "builtin",
    ...over,
  };
}

export function binding(
  targets: readonly { id: string; reversibility: Reversibility }[],
  over: Partial<ResolvedAction> = {},
): ToolBinding {
  return {
    resolve: (): Result<ResolvedAction> =>
      ok({
        concern: "test-owner/notes",
        operation: "record_owned_note",
        contractRevision: "1",
        targets,
        comparison: { basis: approvalOwner.CURRENT_BASIS },
        changes: "records one note",
        external: null,
        reversibility: "the note cannot be removed",
        ...over,
      }),
  };
}

export type Kit = {
  deps: JudgmentDeps;
  judgment: ReturnType<typeof createToolJudgment>;
};

export function kit(
  world: World,
  key: RunKey,
  tools: readonly { definition: ToolDefinition; binding: ToolBinding }[],
  over: Partial<JudgmentDeps> = {},
  targets: readonly string[] = [TARGET, OTHER_TARGET],
): Kit {
  const entry = world.runs[key];
  const deps: JudgmentDeps = {
    clock: world.clock,
    ids: world.ids,
    machine: world.machine,
    agent: coreCall(world.server, entry.token),
    assignment: entry.assignment.id,
    credential: {
      run: entry.run,
      targets: new Set(targets),
      operations: new Set(["record_owned_note"]),
    },
    listed: tools.map((item) => item.definition),
    bindings: new Map(
      tools.map((item) => [item.definition.name, item.binding]),
    ),
    agentHash: AGENT_HASH,
    mcpConnection: () => ({ revision: 1 }),
    approvalTtlMs: 600_000,
    ...over,
  };
  return { deps, judgment: createToolJudgment(deps) };
}

let sequence = 100;

// model이 요청한 tool call을 ledger에 요청 상태로 남긴다. 입력 hash는 실제 입력의 지문이다.
export async function requested(
  world: World,
  run: string,
  definition: ToolDefinition,
  input: unknown,
): Promise<
  {
    toolCall: string;
    run: string;
    tool: string;
    input: unknown;
    stateSeq: string;
  }
> {
  sequence += 1;
  const toolCall = id("tcl", sequence);
  const reply = await world.post("tool-calls/request", MACHINE_TOKEN, {
    id: toolCall,
    run,
    model_call: id("mcl", sequence),
    response_key: `call-${sequence}`,
    response_order: 0,
    tool: definition.name,
    definition_revision: definition.revision,
    effect: definition.effect,
    confirm: definition.confirm,
    extension: null,
    input: await fingerprint(input),
    retry_of: null,
    attempt: 0,
  }, { run_state_seq: "0", model_call_finished_seq: "0" });
  assertEquals(reply.status, 200, JSON.stringify(reply.body));
  return { toolCall, run, tool: definition.name, input, stateSeq: "0" };
}

const SECRET = "sk-test-secret-value";

const attach: SecretAttachLike = {
  send: async (_input, transmit) => await transmit(SECRET),
};

// model이 말하는 protocol. adapter와 fake provider의 응답 모양이 함께 바뀐다.
export type ModelProtocol = "openai-chat-completions" | "anthropic-messages";

const PROTOCOLS = {
  "openai-chat-completions": {
    fake: "chat_completions",
    header: "authorization",
    kind: "bearer",
    call: "call_1",
  },
  "anthropic-messages": {
    fake: "messages",
    header: "x-api-key",
    kind: "api_key",
    call: "toolu_1",
  },
} as const;

// model 쪽은 실제 HTTP로 fake provider를 부른다. script가 준 tool 요청과 글만 받는다.
export async function modelAsks(
  text: string,
  name: string,
  args: unknown,
  protocol: ModelProtocol = "openai-chat-completions",
): Promise<{ text: string; name: string; input: unknown }> {
  const wire = PROTOCOLS[protocol];
  const provider = startFakeProvider({
    script: {
      steps: [{
        id: "ask",
        protocol: wire.fake,
        reply: {
          text,
          toolCalls: [{
            id: wire.call,
            name,
            arguments: JSON.stringify(args),
          }],
          usage: { input: 5, output: 4 },
          stop: "tool_calls",
        },
      }],
    },
    nowMs: () => Date.UTC(2024, 0, 1),
    instant: true,
  });
  try {
    const invoke = createInvokeModelCall({
      transport: createAuthTransport({
        attach,
        transport: createFetchTransport(),
        context: {} as never,
        use: {} as never,
        operation: "model.call",
        headerName: wire.header,
        kind: wire.kind,
      }),
      nowMs: () => Date.UTC(2024, 0, 1),
      at: (ms) => new Date(ms).toISOString(),
    });
    const model: ModelCallInput["model"] = {
      provider: id("pvd", 1),
      name: "fixture-model",
      protocol,
      credential_key: "key-a",
      credential_revision: 1,
      option_values: { requested: {}, applied: {} },
      limits: {
        context_limit: 1000,
        input_limit: 900,
        output_limit: 100,
        supports_tools: true,
      },
      catalog_basis: {},
      price_basis: null,
      billing_route: "api",
    };
    const result = await invoke({
      callId: id("mcl", 1),
      run: null,
      session: null,
      purpose: "judgment",
      model,
      endpoint: provider.url,
      inputHash: "a".repeat(64),
      contextBasisHash: "a".repeat(64),
      body: { model: "fixture-model" },
      timeoutMs: 5000,
      usageRevision: "rev",
    }, new AbortController().signal);
    assert(result.ok, JSON.stringify(result));
    const asked = result.value.toolCalls[0];
    assert(asked !== undefined);
    return {
      text: result.value.text,
      name: asked.name,
      input: JSON.parse(asked.args),
    };
  } finally {
    await provider.close();
  }
}

export { count, inspect };
export type { JsonObject };
