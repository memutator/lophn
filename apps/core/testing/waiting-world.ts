/**
 * 사람 기다림(lophn-agent/harness/waiting-and-recovery) 시험이 같이 쓰는 준비. 실제 core(임시
 * LOPHN_HOME, 실제 ledger)를 띄우고 lophn·Context Engineer assignment마다 사람 요청(세션 메시지)으로
 * 접수해 시작한 run 하나씩과 시험 전용 소유 command(approval-owner)를 함께 등록한다. 기다림의
 * 질문·approval·결정은 모두 실제 core의 command다. model은 부르지 않고 실제 provider와 사람 데이터
 * root는 열지 않는다. 제품 main.ts에는 없다.
 */
import { assert, assertEquals } from "@std/assert";
import {
  createIdSource,
  fingerprint,
  type IdSource,
  manualClock,
  type Result,
  seededRandom,
} from "../../../packages/base/mod.ts";
import type {
  ApprovalRequest,
  AuthenticatedContext,
} from "../../../packages/protocol/platform/mod.ts";
import { answerQuestionAction } from "../../../packages/protocol/lophn-agent/mod.ts";
import {
  createToolJudgment,
  type JudgmentDeps,
  type ToolBinding,
} from "../../../packages/lophn-agent/harness/tool-judgment/mod.ts";
import type { ToolDefinition } from "../../../packages/lophn-agent/harness/tools/mod.ts";
import {
  createWaitResolver,
  type WaitWorkDeps,
} from "../../../packages/lophn-agent/harness/waiting-and-recovery/mod.ts";
import type { CallRequest } from "../../../packages/lophn-agent/harness/tool-judgment/mod.ts";
import { confirmationBinding } from "../../../packages/platform/identity/mod.ts";
import { type Core, startCore } from "../core.ts";
import {
  createLedgerRegistration,
  lophnAgentDefinitions,
} from "../lophn-agent.ts";
import { createLedgerRegistration as createDocumentsRegistration } from "../documents.ts";
import { createLedgerRegistration as createAppsRegistration } from "../apps.ts";
import * as approvalOwner from "./approval-owner.ts";
import {
  call,
  command,
  count,
  decide as humanDecide,
  inspect,
  type Reply,
  type Server,
} from "./approvals-fixture.ts";
import {
  coreCall,
  id,
  MACHINE_TOKEN,
  OTHER_TARGET,
  TARGET,
  USER_TOKEN,
} from "./tool-judgment-world.ts";

export { count, inspect, MACHINE_TOKEN, OTHER_TARGET, TARGET, USER_TOKEN };

const BASIS = "b".repeat(64);
// 시험이 만드는 project와 겹치지 않는 번호다.
const PLACE_PROJECT = id("prj", 250);
const LIMITS = { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 };

const MACHINE_OPERATIONS = [
  "ListAssignments",
  "AcceptRun",
  "StartRun",
  "StopRun",
  "ConfirmNextRun",
  "ReadRun",
  "ListRuns",
  "ReadAssignment",
  "WaitRun",
  "ResolveRunWait",
  "CorrectWaitingRun",
  "ReadQuestionGroup",
  "ReadQuestionText",
  "ExpireQuestionGroup",
  "CancelQuestionGroup",
  "RecordToolRequest",
  "DecideToolCall",
  "StartToolCall",
  "FinishToolCall",
  "ReadToolCall",
  "ListToolCalls",
  "ListApprovals",
  "GetApproval",
  "ReadApprovalText",
  "apply_approved_action",
  "expire_approval_request",
  "cancel_approval_request",
  "record_owned_note",
  "PauseAssignment",
  // 사람이 고른 선택지의 고정 action 적용(questions#R13). 적용 자격은 소유 command의 operation도
  // 가진다: 소유 command의 대상 권한은 바깥 요청 자격의 scope로 본다.
  "ApplyQuestionOption",
  "ApplySettings",
  "GetSettings",
  "SettingsDefinitions",
  "document.move",
  "document.rename",
  "app.create",
];

const USER_OPERATIONS = [
  "ListAssignments",
  "OpenSession",
  "ReadSession",
  "ReceiveMessage",
  "ReadRun",
  "StopRun",
  "AnswerQuestionGroup",
  "AnswerQuestionAction",
  "DeferQuestionGroup",
  "CancelQuestionGroup",
  "ReadQuestionGroup",
  "ReadQuestionText",
  "grant_approval_request",
  "reject_approval_request",
  "cancel_approval_request",
  "GetApproval",
  "ListApprovals",
  "ReadApprovalText",
  "GetSettings",
  "ApplySettings",
  "project.create",
  "context.create",
  "document.get",
  "document.list",
  "document.move",
  "document.rename",
];

export type Assignment = {
  id: string;
  role: string;
  revision: number;
  state: string;
};

export type Seat = {
  assignment: Assignment;
  session: string;
  // 사람 요청 메시지로 접수해 시작한 run.
  run: string;
  message: string;
  agentToken: string;
};

export type WaitingWorld = {
  core: Core;
  server: Server;
  clock: ReturnType<typeof manualClock>;
  ids: IdSource;
  lophn: Seat;
  editor: Seat;
  machine: ReturnType<typeof coreCall>;
  post(
    path: string,
    token: string,
    input: unknown,
    compare?: unknown,
  ): Promise<Reply>;
  read(path: string, token: string, input: unknown): Promise<Reply>;
  advance(ms: number): Promise<void>;
  dispose(): Promise<void>;
};

export function context(
  actor: string,
  operations: string[],
  targets: Record<string, string> = {},
  ref = "none",
): AuthenticatedContext {
  return {
    principal: actor,
    actor,
    scope: { operations, targets },
    conditions: targets,
    credential_ref: `cred-${actor}-${ref}`,
  } as AuthenticatedContext;
}

export async function acceptCredential(
  core: Core,
  credential: AuthenticatedContext,
  token: string,
) {
  const accepted = await core.acceptTestCredential?.(credential, token);
  assert(accepted?.ok);
  const recorded = await core.record(credential);
  assert(recorded.ok);
}

let tokens = 0;

// documents는 항상 띄운다: 세션이 자리로 받는 project가 documents 등록의 몫이고, 문서 자리
// 이동 같은 소유 command의 option action을 실제 문서로 본다. apps는 앱 등록의 option action을 본다.
export type WaitingWorldOptions = { apps?: boolean };

export async function openWaitingWorld(
  options: WaitingWorldOptions = {},
): Promise<WaitingWorld> {
  const home = await Deno.makeTempDir({ prefix: "lophn-waiting-" });
  const clock = manualClock(Date.UTC(2024, 0, 1));
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [
      { lophnAgentDefinitions, createLedgerRegistration },
      approvalOwner,
      { createLedgerRegistration: createDocumentsRegistration },
      ...(options.apps
        ? [{ createLedgerRegistration: createAppsRegistration }]
        : []),
    ],
    teamModules: [
      new URL("../lophn-agent.ts", import.meta.url).href,
      new URL("./approval-owner.ts", import.meta.url).href,
      new URL("../documents.ts", import.meta.url).href,
      ...(options.apps ? [new URL("../apps.ts", import.meta.url).href] : []),
    ],
    clock,
    random: seededRandom(51),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : JSON.stringify(started.error));
  const core = started.value;
  const server: Server = {
    port: core.port,
    dataRoot: core.dataRoot,
    clock,
    confirmation: (body) =>
      core.confirmation?.(body) ??
        Promise.resolve({ ok: false as const, error: { message: "없다" } }),
  };
  await acceptCredential(
    core,
    context("machine", MACHINE_OPERATIONS),
    MACHINE_TOKEN,
  );
  await acceptCredential(core, context("user", USER_OPERATIONS), USER_TOKEN);
  const post = (
    path: string,
    token: string,
    input: unknown,
    compare: unknown = {},
  ) => call(server, path, token, command(input, { compare }));
  const listed = await call(server, "assignments/list", MACHINE_TOKEN, {});
  assertEquals(listed.status, 200, JSON.stringify(listed.body));
  const assignments = listed.body["assignments"] as Assignment[];
  const ids = createIdSource({ clock, random: seededRandom(78) });
  // 세션은 쓸 수 있는 project 하나를 자리로 받는다(Context Engineer는 project만 받는다).
  const project = await post("projects/create", USER_TOKEN, {
    id: PLACE_PROJECT,
    name: "session-place",
    title: "session-place",
    purpose: "",
    folders: [],
    tracking: { enabled: false, patterns: [], use_gitignore: false },
  });
  assertEquals(project.status, 200, JSON.stringify(project.body));
  let order = 0;
  const seat = async (role: string): Promise<Seat> => {
    const assignment = assignments.find((entry) => entry.role === role);
    assert(assignment !== undefined, role);
    order += 1;
    const session = id("ses", order);
    const message = id("msg", order);
    const opened = await post(
      "sessions/open",
      USER_TOKEN,
      {
        id: session,
        assignment: assignment.id,
        work_place: { kind: "project", id: PLACE_PROJECT },
        opening_context: null,
      },
      { assignment_revision: assignment.revision, assignment_state: "enabled" },
    );
    assertEquals(opened.status, 200, JSON.stringify(opened.body));
    const state = await call(server, "sessions/read", USER_TOKEN, { session });
    assertEquals(state.status, 200, JSON.stringify(state.body));
    const sent = await post(
      "messages/receive",
      USER_TOKEN,
      {
        id: message,
        session,
        content: {
          schema_version: 1,
          parts: [{ kind: "text", text: "기다림이 필요한 일" }],
        },
        mode: "request",
      },
      {
        session_state: "open",
        session_state_seq: (state.body as {
          session: { state_seq: string };
        }).session.state_seq,
        assignment_revision: assignment.revision,
        assignment_state: "enabled",
      },
    );
    assertEquals(sent.status, 200, JSON.stringify(sent.body));
    const run = (sent.body as { message: { run: string } }).message.run;
    const read = await call(server, "runs/read", MACHINE_TOKEN, { run });
    assertEquals(read.status, 200, JSON.stringify(read.body));
    const startedRun = await post(
      "runs/start",
      MACHINE_TOKEN,
      {
        run,
        basis: BASIS,
        limits: LIMITS,
        scope: { role, assignment: assignment.id, apps: [] },
      },
      {
        state_seq: (read.body as { run: { state_seq: string } }).run.state_seq,
      },
    );
    assertEquals(startedRun.status, 200, JSON.stringify(startedRun.body));
    tokens += 1;
    const agentToken = `x${role[0]}${tokens}`.padEnd(43, "q");
    await acceptCredential(
      core,
      context(
        `agent:${assignment.id}`,
        [
          "create_approval_request",
          "ReadApprovalText",
          "CreateQuestionGroup",
          "ReadQuestionGroup",
          "ReadQuestionText",
        ],
        { assignment: assignment.id, run },
        run,
      ),
      agentToken,
    );
    return { assignment, session, run, message, agentToken };
  };
  const lophn = await seat("lophn");
  const editor = await seat("context_engineer");
  return {
    core,
    server,
    clock,
    ids,
    lophn,
    editor,
    machine: coreCall(server, MACHINE_TOKEN),
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

// ---------------------------------------------------------------------------
// tool call과 판정. model은 부르지 않는다.
// ---------------------------------------------------------------------------

let sequence = 200;

export async function requestTool(
  world: WaitingWorld,
  seat: Seat,
  definition: ToolDefinition,
  input: unknown,
): Promise<CallRequest> {
  sequence += 1;
  const toolCall = id("tcl", sequence);
  const reply = await world.post("tool-calls/request", MACHINE_TOKEN, {
    id: toolCall,
    run: seat.run,
    model_call: id("mcl", sequence),
    response_key: `wait-call-${sequence}`,
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
  return {
    toolCall,
    run: seat.run,
    tool: definition.name,
    input,
    stateSeq: "0",
  };
}

export function judgmentFor(
  world: WaitingWorld,
  seat: Seat,
  tools: readonly { definition: ToolDefinition; binding: ToolBinding }[],
  over: Partial<JudgmentDeps> = {},
) {
  const deps: JudgmentDeps = {
    clock: world.clock,
    ids: world.ids,
    machine: world.machine,
    agent: coreCall(world.server, seat.agentToken),
    assignment: seat.assignment.id,
    credential: {
      run: seat.run,
      targets: new Set([TARGET, OTHER_TARGET]),
      operations: new Set(["record_owned_note"]),
    },
    listed: tools.map((item) => item.definition),
    bindings: new Map(
      tools.map((item) => [item.definition.name, item.binding]),
    ),
    agentHash: "ab".repeat(32),
    mcpConnection: () => ({ revision: 1 }),
    approvalTtlMs: 600_000,
    ...over,
  };
  return createToolJudgment(deps);
}

// 기다림 해소기. 고정 call의 실제 입력은 runtime이 가진 값이므로 시험이 넘긴다.
export function resolverFor(
  world: WaitingWorld,
  judgment: WaitWorkDeps["judgment"],
  requests: ReadonlyMap<string, CallRequest>,
) {
  return createWaitResolver({
    machine: world.machine,
    judgment,
    callRequest: (toolCall) =>
      Promise.resolve(
        requests.has(toolCall)
          ? { ok: true as const, value: requests.get(toolCall)! }
          : {
            ok: false as const,
            error: { code: "not_found" as const, message: "no input" },
          },
      ) as Promise<Result<CallRequest>>,
  });
}

export async function approvalOf(
  world: WaitingWorld,
  approval: string,
): Promise<ApprovalRequest> {
  const read = await world.read("approvals/get", USER_TOKEN, { approval });
  assertEquals(read.status, 200, JSON.stringify(read.body));
  return read.body["request"] as ApprovalRequest;
}

export async function humanDecides(
  world: WaitingWorld,
  approval: string,
  decision: "grant" | "reject",
  reason: string | null = null,
) {
  const reply = await humanDecide(
    world.server,
    USER_TOKEN,
    await approvalOf(world, approval),
    decision,
    reason,
  );
  assertEquals(reply.status, 200, JSON.stringify(reply.body));
}

// 사람이 confirmation window에서 본 내용으로 handle을 발급한다. 확인이 필요한 command(고정 action이
// 있는 선택지의 답)용이다.
export async function issueConfirmation(
  world: WaitingWorld,
  route: typeof answerQuestionAction,
  input: Record<string, unknown>,
): Promise<string> {
  const binding = await confirmationBinding(route, input);
  assert(binding, "no confirmation binding");
  const issued = await world.server.confirmation({
    action: "issue",
    request: {
      type: "confirmation_handle_register",
      window_id: `win-${route.name}`,
      target_ref: binding.target,
      content_hash: binding.content,
      allowed_decisions: [route.name],
      expires_at: new Date(world.clock.nowMs() + 120_000).toISOString(),
    },
  });
  assert(issued.ok, issued.ok ? "" : issued.error.message);
  return (issued.value as { confirmation: string }).confirmation;
}

export type { CallRequest, JudgmentDeps, Reply, ToolBinding, ToolDefinition };
