// lophn-agent/handoff를 실제 core와 임시 LOPHN_HOME, 가짜 시계에서 본다(사람 데이터 root와
// 실제 provider는 쓰지 않는다). run과 handoff 계보는 모두 실제 command로 만든다: 사람 요청에서
// 시작해 시작한 lophn run, 그 run의 agent 자격이 SubmitHandoff로 만든 Context Engineer run,
// 다른 사람 요청의 run. platform/approvals#R16의 거절 억제는 handoff tool이 만든 실제 계보로
// 확인한다(platform#T22에서 넘어온 통합 시험). 순수 규칙은 packages/lophn-agent/handoff/
// handoff_test.ts가 본다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { createHash } from "node:crypto";
import {
  canonicalize,
  manualClock,
  seededRandom,
} from "../../packages/base/mod.ts";
import {
  type ApprovalAction,
  type ApprovalRequest,
  type AuthenticatedContext,
  REDACTION_REPLACEMENT,
} from "../../packages/protocol/platform/mod.ts";
import {
  handoffBodyHash,
  handoffContentBytes,
} from "../../packages/core/lophn-agent/tools/handoff/mod.ts";
import {
  AGENT_TOOLS,
  type AgentToolPorts,
  BUILTIN_TOOLS,
  createAgentToolHandlers,
  executeTool,
  listTools,
} from "../../packages/core/lophn-agent/tools/mod.ts";
import { ROUTES } from "../../packages/protocol/lophn-agent/mod.ts";
import { type Core, startCore } from "./core.ts";
import { lophnAgentDefinitions } from "./lophn-agent.ts";
import {
  actionOf,
  call,
  codeOf,
  command,
  count,
  createInput,
  decide,
  inspect,
  type Reply,
  type Server,
} from "./testing/approvals-fixture.ts";
import { setAssignmentState } from "./testing/assignment-state.ts";
import { closeUnlessKept } from "./testing/close-on-throw.ts";

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

const MSG_ONE = id("msg", 1);
const MSG_TWO = id("msg", 2);
const RUN_A = id("run", 1);
const RUN_B = id("run", 2);
const RUN_C = id("run", 3);
const DOC = id("doc", 1);
const VER_ONE = id("ver", 1);
const VER_TWO = id("ver", 2);
const TARGET = "doc_01h455vb4pex5v6nkc6gd5fdw1";
const BASIS = "b".repeat(64);
const FINAL = "d".repeat(64);
const LIMITS = { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 };
const REQUESTS = "select count(*) as n from approval_requests";

type Assignment = { id: string; role: string; revision: number; state: string };

const CONTENT = {
  what: "문서 묶음을 정리해 context에 담는다",
  why: "사람이 요청한 정리를 Context Engineer가 맡는다",
  excludes: ["앱 코드는 바꾸지 않는다"],
  expected_outputs: ["정리된 context 하나"],
};

const REFERENCE = {
  document: DOC,
  version: VER_ONE,
  section: null,
  question: null,
};

type World = {
  core: Core;
  server: Server;
  home: string;
  tokens: number;
  user: string;
  machine: string;
  lophn: Assignment;
  editor: Assignment;
  dispose(): Promise<void>;
};

function context(
  actor: string,
  operations: string[],
  targets: Record<string, string> = {},
  ref = `cred-${actor}-${targets["run"] ?? "none"}`,
): AuthenticatedContext {
  return {
    principal: actor,
    actor,
    scope: { operations, targets },
    conditions: targets,
    credential_ref: ref,
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

async function send(
  world: Pick<World, "server">,
  path: string,
  token: string,
  input: unknown,
  compare: unknown = {},
): Promise<Reply> {
  return await call(world.server, path, token, command(input, { compare }));
}

async function read(
  world: Pick<World, "server">,
  path: string,
  token: string,
  input: unknown,
): Promise<Reply> {
  return await call(world.server, path, token, input);
}

const AGENT_OPERATIONS = [
  "ReadAssignment",
  "SubmitHandoff",
  "ReadHandoffStatus",
  "ReadHandoffResult",
  "ReadRun",
  "CreateQuestionGroup",
  "create_approval_request",
];

// 이 run에 묶인 agent 자격. 같은 assignment가 run마다 다른 자격을 받는다.
async function agentFor(
  world: World,
  assignment: Assignment,
  run: string,
): Promise<string> {
  const n = ++world.tokens;
  const actor = `agent:${assignment.id}`;
  const token = `g${n}`.padEnd(43, "h");
  await accept(
    world.core,
    context(
      actor,
      AGENT_OPERATIONS,
      { assignment: assignment.id, run },
      `cred-${actor}-${run}-${n}`,
    ),
    token,
  );
  return token;
}

async function open(): Promise<World> {
  const home = await Deno.makeTempDir({ prefix: "lophn-handoff-" });
  const clock = manualClock(Date.UTC(2024, 0, 1));
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ lophnAgentDefinitions }],
    teamModules: [new URL("./lophn-agent.ts", import.meta.url).href],
    clock,
    random: seededRandom(43),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : JSON.stringify(started.error));
  await using guard = closeUnlessKept(async () => {
    await started.value.shutdown();
    await Deno.remove(home, { recursive: true });
  });
  const core = started.value;
  const server: Server = {
    port: core.port,
    dataRoot: core.dataRoot,
    clock,
    confirmation: (body) =>
      core.confirmation?.(body) ??
        Promise.resolve({ ok: false as const, error: { message: "없다" } }),
  };
  const machine = "m".repeat(43);
  const user = "u".repeat(43);
  await accept(
    core,
    context("machine", [
      "ListAssignments",
      "AcceptRun",
      "StartRun",
      "FinishRun",
      "ReadRun",
      "ReadHandoffStatus",
      "ReadHandoffResult",
    ]),
    machine,
  );
  await accept(
    core,
    context("user", [
      "reject_approval_request",
      "grant_approval_request",
      "GetApproval",
      "ListApprovals",
      "AnswerQuestionGroup",
      "PauseAssignment",
      "ResumeAssignment",
      "StopRun",
      "ReadRun",
      "ReadHandoffStatus",
      "ReadHandoffResult",
    ]),
    user,
  );
  const listed = await call(server, "assignments/list", machine, {});
  assertEquals(listed.status, 200, JSON.stringify(listed.body));
  const assignments = listed.body["assignments"] as Assignment[];
  // 기동이 lophn과 Context Engineer 전역 assignment를 준비한다.
  const lophn = assignments.find((entry) => entry.role === "lophn");
  const editor = assignments.find((entry) => entry.role === "context_engineer");
  assert(lophn && editor);
  guard.keep();
  return {
    core,
    server,
    home,
    tokens: 0,
    user,
    machine,
    lophn,
    editor,
    async dispose() {
      await core.shutdown();
      await Deno.remove(home, { recursive: true });
    },
  };
}

async function acceptMessageRun(
  world: World,
  run: string,
  assignment: Assignment,
  message: string,
): Promise<void> {
  const accepted = await send(world, "runs/accept", world.machine, {
    id: run,
    assignment: assignment.id,
    session: null,
    source: { kind: "message", message },
    continued_from: null,
    start_after: null,
  }, { assignment_revision: assignment.revision });
  assertEquals(accepted.status, 200, JSON.stringify(accepted.body));
}

async function readRun(world: World, run: string) {
  const reply = await read(world, "runs/read", world.machine, { run });
  assertEquals(reply.status, 200, JSON.stringify(reply.body));
  return reply.body["run"] as {
    state: string;
    state_seq: string;
    source: Record<string, unknown>;
    session: string | null;
  };
}

async function startRun(
  world: World,
  run: string,
  assignment: Assignment,
): Promise<void> {
  const record = await readRun(world, run);
  const started = await send(world, "runs/start", world.machine, {
    run,
    basis: BASIS,
    limits: LIMITS,
    scope: { role: assignment.role, assignment: assignment.id, apps: [] },
  }, { state_seq: record.state_seq });
  assertEquals(started.status, 200, JSON.stringify(started.body));
}

async function finishRun(world: World, run: string): Promise<Reply> {
  const record = await readRun(world, run);
  return await send(world, "runs/finish", world.machine, {
    run,
    outcome: { kind: "completed", reason: "answer_completed" },
    result: FINAL,
  }, { state_seq: record.state_seq });
}

type Submit = {
  sender_run: string;
  receiver_run: string;
  receiver_assignment: string;
  from_role: string;
  to_role: string;
  original_message: string;
  content: typeof CONTENT;
  body: string;
  references: unknown[];
  dedup_key: string;
};

function submission(
  world: World,
  over: Partial<Submit> = {},
): Submit {
  const content = over.content ?? CONTENT;
  return {
    sender_run: RUN_A,
    receiver_run: RUN_B,
    receiver_assignment: world.editor.id,
    from_role: "lophn",
    to_role: "context_engineer",
    original_message: MSG_ONE,
    content,
    body: handoffBodyHash(content),
    references: [REFERENCE],
    dedup_key: "handoff-one",
    ...over,
  };
}

async function submit(
  world: World,
  token: string,
  input: Submit,
): Promise<Reply> {
  return await send(world, "handoffs/submit", token, input);
}

// 사람 요청 하나에서 시작한 lophn run A(시작함)와 그 run의 agent 자격.
async function lophnRun(world: World): Promise<string> {
  await acceptMessageRun(world, RUN_A, world.lophn, MSG_ONE);
  await startRun(world, RUN_A, world.lophn);
  return await agentFor(world, world.lophn, RUN_A);
}

function runsCount(world: World): number {
  return count(world.server, "select count(*) as n from runs");
}

Deno.test("lophn-agent/handoff#R1: 허용 방향의 handoff는 받는 assignment에 독립 run 하나를 접수하고 Context Engineer에서 lophn으로 되돌릴 수 있다", async () => {
  const world = await open();
  try {
    const sender = await lophnRun(world);
    const sent = await submit(world, sender, submission(world));
    assertEquals(sent.status, 200, JSON.stringify(sent.body));
    const result = (sent.body["result"] ?? sent.body) as {
      receiver_run: string;
      replayed: boolean;
    };
    assertEquals(result.receiver_run, RUN_B);
    assertEquals(result.replayed, false);
    // 받는 run은 받는 assignment의 독립 run이다: 세션도 선행도 이어가기도 없다.
    const run = await readRun(world, RUN_B);
    assertEquals(run.state, "accepted");
    assertEquals(run.session, null);
    const row = inspect(
      world.server,
      "select assignment, continued_from, start_after from runs where id = ?",
      [RUN_B],
    )[0];
    assertEquals(row?.["assignment"], world.editor.id);
    assertEquals(row?.["continued_from"], null);
    assertEquals(row?.["start_after"], null);

    // 되돌리는 방향(Context Engineer → lophn)도 허용 방향이다.
    await startRun(world, RUN_B, world.editor);
    const editorAgent = await agentFor(world, world.editor, RUN_B);
    const back = await submit(
      world,
      editorAgent,
      submission(world, {
        sender_run: RUN_B,
        receiver_run: RUN_C,
        receiver_assignment: world.lophn.id,
        from_role: "context_engineer",
        to_role: "lophn",
        dedup_key: "handoff-back",
      }),
    );
    assertEquals(back.status, 200, JSON.stringify(back.body));
    assertEquals(
      inspect(world.server, "select assignment from runs where id = ?", [
        RUN_C,
      ])[0]?.["assignment"],
      world.lophn.id,
    );

    // 허용 밖 방향은 접수하지 않는다: 같은 역할끼리, Context Engineer → App Engineer,
    // Operator의 보내기와 받기.
    const before = runsCount(world);
    for (
      const [from, to] of [
        ["lophn", "lophn"],
        ["context_engineer", "app_engineer"],
        ["operator", "lophn"],
        ["lophn", "operator"],
      ] as const
    ) {
      const refused = await submit(
        world,
        sender,
        submission(world, {
          from_role: from,
          to_role: to,
          dedup_key: `direction-${from}-${to}`,
        }),
      );
      assertEquals(codeOf(refused), "invalid_input", `${from} to ${to}`);
    }
    assertEquals(runsCount(world), before);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/handoff#R2: 받을 assignment가 없거나 멈췄으면 거절하고 담당 없는 대기열은 만들지 않으며 재전송 replay는 저장된 결과만 준다", async () => {
  const world = await open();
  try {
    const sender = await lophnRun(world);
    const before = runsCount(world);
    // 없는 assignment: 이유가 보이는 unavailable이고 run은 생기지 않는다.
    const missing = await submit(
      world,
      sender,
      submission(world, {
        receiver_assignment: id("asg", 30),
        dedup_key: "missing",
      }),
    );
    assertEquals(codeOf(missing), "unavailable");
    // 받는 역할 이름이 실제 assignment의 역할과 다르면 시작하지 않는다.
    const wrongRole = await submit(
      world,
      sender,
      submission(world, { to_role: "app_engineer", dedup_key: "wrong-role" }),
    );
    assertEquals(codeOf(wrongRole), "invalid_input");
    // 자기 assignment로 보내는 것은 handoff가 아니다.
    const self = await submit(
      world,
      sender,
      submission(world, {
        receiver_assignment: world.lophn.id,
        to_role: "lophn",
        dedup_key: "self",
      }),
    );
    assertEquals(codeOf(self), "invalid_input");

    // 사람이 받는 assignment를 멈추면 새 handoff는 시작되지 않는다.
    setAssignmentState(world.server.dataRoot, world.editor.id, "paused");
    const stopped = await submit(
      world,
      sender,
      submission(world, { dedup_key: "paused" }),
    );
    assertEquals(codeOf(stopped), "unavailable");
    assertEquals(runsCount(world), before);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/handoff#R3: 설명과 고정 근거가 빠진 전달은 시작하지 않고 채택 질문은 그 판을 채택한 답이어야 한다", async () => {
  const world = await open();
  try {
    const sender = await lophnRun(world);
    const before = runsCount(world);
    const broken: [string, Partial<Submit>][] = [
      ["what", { content: { ...CONTENT, what: "   " } }],
      ["why", { content: { ...CONTENT, why: "" } }],
      ["expected", { content: { ...CONTENT, expected_outputs: [] } }],
      ["references", { references: [] }],
      ["sender", { sender_run: id("run", 40) }],
    ];
    for (const [name, over] of broken) {
      const refused = await submit(
        world,
        sender,
        submission(world, { ...over, dedup_key: `broken-${name}` }),
      );
      assertNotEquals(refused.status, 200, name);
    }
    const extra = await send(world, "handoffs/submit", sender, {
      ...submission(world, { dedup_key: "extra" }),
      approval: id("apr", 1),
    });
    assertEquals(codeOf(extra), "invalid_input");

    // 답이 없는 질문과 다른 판을 채택한 질문은 근거가 될 수 없다.
    const group = id("qgr", 1);
    const question = id("qst", 1);
    const created = await send(world, "questions/create", sender, {
      id: group,
      run: RUN_A,
      session: null,
      expires_at: null,
      questions: [{
        id: question,
        prompt: "어느 정리 방안으로 갈까요",
        reason: "두 방안 중 하나를 채택해야 한다",
        options: [{
          key: "one",
          label: "첫째",
          description: "첫째 방안",
          evidence: [],
          adoption: { document: DOC, version: VER_ONE, section: null },
          action: null,
        }],
        recommendation: null,
      }],
    });
    assertEquals(created.status, 200, JSON.stringify(created.body));
    const adopting = [{ ...REFERENCE, question }];
    const pending = await submit(
      world,
      sender,
      submission(world, { references: adopting, dedup_key: "pending" }),
    );
    assertEquals(codeOf(pending), "invalid_input");

    const createdSeq = ((created.body["result"] ?? created.body) as {
      created_seq: string;
    }).created_seq;
    const answered = await send(
      world,
      "questions/answer",
      world.user,
      {
        group,
        created_seq: createdSeq,
        answers: [{
          question,
          answer: { kind: "option", option_key: "one" },
        }],
      },
      { created_seq: createdSeq },
    );
    assertEquals(answered.status, 200, JSON.stringify(answered.body));

    const other = await submit(
      world,
      sender,
      submission(world, {
        references: [{ ...REFERENCE, version: VER_TWO, question }],
        dedup_key: "other-version",
      }),
    );
    assertEquals(codeOf(other), "invalid_input");
    assertEquals(runsCount(world), before);

    // 같은 판을 채택한 답이면 접수한다. 판과 질문은 받는 run의 source에 구조로 남는다.
    const adopted = await submit(
      world,
      sender,
      submission(world, { references: adopting, dedup_key: "adopted" }),
    );
    assertEquals(adopted.status, 200, JSON.stringify(adopted.body));
    const source = (await readRun(world, RUN_B)).source;
    assertEquals(source["references"], adopting);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/handoff#R4: 받는 run에는 필요한 설명과 고정 근거만 있고 내용은 redaction을 거친 blob 하나이며 세션·tool 기록은 복사되지 않는다", async () => {
  const world = await open();
  try {
    const sender = await lophnRun(world);
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz0123";
    const leaky = { ...CONTENT, why: `토큰 ${secret}을 그대로 붙였다` };
    const sent = await submit(
      world,
      sender,
      submission(world, { content: leaky }),
    );
    assertEquals(sent.status, 200, JSON.stringify(sent.body));
    // 저장된 내용은 secret을 가린 값이고 body hash는 그 값의 정규 bytes에서 나온다.
    const stored = {
      ...CONTENT,
      why: `토큰 ${REDACTION_REPLACEMENT}을 그대로 붙였다`,
    };
    const source = (await readRun(world, RUN_B)).source;
    assertEquals(source["body"], handoffBodyHash(stored));
    assertNotEquals(source["body"], handoffBodyHash(leaky));
    const ref = inspect(
      world.server,
      `select hash, size_bytes from blob_refs
       where owner_kind = 'run' and owner_key = ? and field = 'handoff_content'`,
      [RUN_B],
    );
    assertEquals(ref.length, 1);
    assertEquals(ref[0]?.["hash"], source["body"]);
    assertEquals(
      Number(ref[0]?.["size_bytes"]),
      handoffContentBytes(stored).length,
    );
    // source에는 정해진 구조만 있다: 보낸 쪽 세션·tool 기록·요약을 실을 자리가 없다.
    assertEquals(Object.keys(source).sort(), [
      "body",
      "dedup_key",
      "kind",
      "original_message",
      "references",
      "sender_run",
    ]);
    const run = await readRun(world, RUN_B);
    assertEquals(run.session, null);
    // 구조 밖 필드(세션 원문 같은 것)는 schema가 거절한다.
    const copied = await send(world, "handoffs/submit", sender, {
      ...submission(world, { dedup_key: "copied" }),
      content: { ...CONTENT, session: "대화 원문 전체" },
    });
    assertEquals(codeOf(copied), "invalid_input");
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/handoff#R5: handoff는 원래 사람 요청에서 이어진 run에서만 보내고 보낸 run은 전달 사실로 끝나며 받은 결과가 새 판단을 시작하지 않는다", async () => {
  const world = await open();
  try {
    const sender = await lophnRun(world);
    // 보낸 run의 원래 요청과 다른 요청으로는 보낼 수 없다.
    const foreign = await submit(
      world,
      sender,
      submission(world, { original_message: MSG_TWO, dedup_key: "foreign" }),
    );
    assertEquals(codeOf(foreign), "invalid_input");
    // 자기 자격에 묶이지 않은 run은 없는 run과 같다.
    const other = await submit(
      world,
      sender,
      submission(world, { sender_run: RUN_C, dedup_key: "other-run" }),
    );
    assertEquals(codeOf(other), "not_found");

    const sent = await submit(world, sender, submission(world));
    assertEquals(sent.status, 200, JSON.stringify(sent.body));
    // 보낸 run은 전달 사실을 남기고 끝난다. 끝난 뒤에도 전달 현황을 읽을 수 있다.
    const finished = await finishRun(world, RUN_A);
    assertEquals(finished.status, 200, JSON.stringify(finished.body));
    const status = await read(world, "handoffs/status", world.user, {
      sender_run: RUN_A,
      dedup_key: "handoff-one",
    });
    assertEquals(status.status, 200, JSON.stringify(status.body));
    assertEquals(status.body["receiver_run"], RUN_B);
    assertEquals(status.body["state"], "accepted");

    // 받는 run이 끝나도 보낸 역할의 새 run은 생기지 않는다(자동 재접수 없음).
    await startRun(world, RUN_B, world.editor);
    const runs = runsCount(world);
    const done = await finishRun(world, RUN_B);
    assertEquals(done.status, 200, JSON.stringify(done.body));
    assertEquals(runsCount(world), runs);
    assertEquals(
      count(
        world.server,
        "select count(*) as n from runs where assignment = ? and state = 'accepted'",
        [world.lophn.id],
      ),
      0,
    );
    // 끝난 보낸 run은 새 handoff를 보내지 못한다.
    const late = await submit(
      world,
      sender,
      submission(world, {
        receiver_run: RUN_C,
        dedup_key: "late",
      }),
    );
    assertNotEquals(late.status, 200);
    assertEquals(runsCount(world), runs);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/handoff#R6: 발신 approval 결정은 수신에서 이어지지 않고 수신 run이 같은 동작을 새로 판정받는다", async () => {
  const world = await open();
  try {
    const sender = await lophnRun(world);
    const sent = await submit(world, sender, submission(world));
    assertEquals(sent.status, 200, JSON.stringify(sent.body));
    const receiver = await agentFor(world, world.editor, RUN_B);
    const a = `agent:${world.lophn.id}`;
    const b = `agent:${world.editor.id}`;
    const asked = await call(
      world.server,
      "approvals/create",
      sender,
      command(
        await createInput(
          id("apr", 1),
          a,
          await action(a, "granted"),
          { run: RUN_A, reason: "처음 묻는다" },
        ),
      ),
    );
    assertEquals(asked.status, 200, JSON.stringify(asked.body));
    const granted = await decide(
      world.server,
      world.user,
      asked.body["request"] as ApprovalRequest,
      "grant",
    );
    assertEquals(granted.status, 200, JSON.stringify(granted.body));
    // 같은 동작을 받은 run이 묻는다: 허락은 옮겨지지 않아 새 request가 pending으로 생긴다.
    const again = await call(
      world.server,
      "approvals/create",
      receiver,
      command(
        await createInput(
          id("apr", 2),
          b,
          await action(b, "granted"),
          { run: RUN_B, reason: "받은 일이라 묻는다" },
        ),
      ),
    );
    assertEquals(again.status, 200, JSON.stringify(again.body));
    const fresh = again.body["request"] as ApprovalRequest;
    assertEquals(fresh.id, id("apr", 2));
    assertNotEquals(fresh.id, id("apr", 1));
    assertEquals(count(world.server, REQUESTS), 2);
    // 발신 권한·approval을 실을 필드가 handoff 입력에 없다.
    const smuggled = await send(world, "handoffs/submit", sender, {
      ...submission(world, { dedup_key: "smuggle", receiver_run: RUN_C }),
      grant: id("apr", 1),
    });
    assertEquals(codeOf(smuggled), "invalid_input");
  } finally {
    await world.dispose();
  }
});

function action(caller: string, note: string): Promise<ApprovalAction> {
  return actionOf({
    command: "record_owned_note",
    caller: caller as ApprovalAction["caller"],
    targets: [TARGET],
    value: { note },
    comparison: { basis: "current" },
  });
}

Deno.test("lophn-agent/handoff#R7: handoff tool이 만든 run 계보에서 사람이 거절한 같은 동작은 다시 묻지 않고 새 사람 요청은 막지 않는다", async () => {
  const world = await open();
  try {
    const sender = await lophnRun(world);
    const sent = await submit(world, sender, submission(world));
    assertEquals(sent.status, 200, JSON.stringify(sent.body));
    const receiver = await agentFor(world, world.editor, RUN_B);
    const a = `agent:${world.lophn.id}`;
    const b = `agent:${world.editor.id}`;
    const first = await call(
      world.server,
      "approvals/create",
      sender,
      command(
        await createInput(
          id("apr", 1),
          a,
          await action(a, "first"),
          { run: RUN_A, reason: "처음 묻는다" },
        ),
      ),
    );
    assertEquals(first.status, 200, JSON.stringify(first.body));
    const rejected = await decide(
      world.server,
      world.user,
      first.body["request"] as ApprovalRequest,
      "reject",
    );
    assertEquals(rejected.status, 200, JSON.stringify(rejected.body));

    // 같은 run이 설명만 바꿔 다시 묻는다: 억제한다.
    const sameRun = await call(
      world.server,
      "approvals/create",
      sender,
      command(
        await createInput(
          id("apr", 2),
          a,
          await action(a, "first"),
          { run: RUN_A, reason: "설명을 바꿔 다시 묻는다" },
        ),
      ),
    );
    assertEquals(sameRun.status, 409, JSON.stringify(sameRun.body));

    // handoff로 이어진 역할의 run도 같은 동작을 다시 묻지 못한다(호출자 역할은 달라도 같다).
    const handedOff = await call(
      world.server,
      "approvals/create",
      receiver,
      command(
        await createInput(
          id("apr", 3),
          b,
          await action(b, "first"),
          { run: RUN_B, reason: "넘겨받은 일이라 묻는다" },
        ),
      ),
    );
    assertEquals(handedOff.status, 409, JSON.stringify(handedOff.body));
    assertEquals(codeOf(handedOff), "conflict");
    assertEquals(
      (handedOff.body["error"] as { details?: { rejected_approval?: string } })
        .details?.rejected_approval,
      id("apr", 1),
    );
    assertEquals(count(world.server, REQUESTS), 1);

    // 입력이 다르면 같은 동작이 아니다.
    const otherInput = await call(
      world.server,
      "approvals/create",
      receiver,
      command(
        await createInput(
          id("apr", 4),
          b,
          await action(b, "other"),
          { run: RUN_B, reason: "입력이 다르다" },
        ),
      ),
    );
    assertEquals(otherInput.status, 200, JSON.stringify(otherInput.body));

    // 새로운 사람 요청(MSG_TWO)의 run은 같은 동작을 다시 물을 수 있다.
    await acceptMessageRun(world, RUN_C, world.lophn, MSG_TWO);
    const fresh = await agentFor(world, world.lophn, RUN_C);
    const again = await call(
      world.server,
      "approvals/create",
      fresh,
      command(
        await createInput(
          id("apr", 5),
          a,
          await action(a, "first"),
          { run: RUN_C, reason: "새 요청이라 묻는다" },
        ),
      ),
    );
    assertEquals(again.status, 200, JSON.stringify(again.body));
    assertEquals(count(world.server, REQUESTS), 3);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/handoff#R8: 결과는 끝나기 전에는 비어 있고 끝난 뒤에는 산출물이 없는 이유를 run의 확정 결과로 남긴다", async () => {
  const world = await open();
  try {
    const sender = await lophnRun(world);
    const sent = await submit(world, sender, submission(world));
    assertEquals(sent.status, 200, JSON.stringify(sent.body));
    const open = await read(world, "handoffs/result", sender, {
      receiver_run: RUN_B,
    });
    assertEquals(open.status, 200, JSON.stringify(open.body));
    assertEquals(open.body["finished"], false);
    assertEquals(open.body["result"], null);
    assertEquals(open.body["version"], null);
    assertEquals(open.body["absent_reason"], null);

    await startRun(world, RUN_B, world.editor);
    const done = await finishRun(world, RUN_B);
    assertEquals(done.status, 200, JSON.stringify(done.body));
    const closed = await read(world, "handoffs/result", sender, {
      receiver_run: RUN_B,
    });
    assertEquals(closed.status, 200, JSON.stringify(closed.body));
    assertEquals(closed.body["finished"], true);
    assertEquals(closed.body["result"], FINAL);
    // 문서를 저장하지 않은 run은 version이 없고 이유가 그 확정 결과다.
    assertEquals(closed.body["version"], null);
    assertEquals(closed.body["absent_reason"], FINAL);
    // 다른 assignment의 agent는 이 handoff를 없는 것으로 본다.
    const stranger = await agentFor(
      world,
      { ...world.lophn, id: id("asg", 31) },
      id("run", 41),
    );
    const hidden = await read(world, "handoffs/result", stranger, {
      receiver_run: RUN_B,
    });
    assertEquals(codeOf(hidden), "not_found");
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/handoff#R9: 같은 handoff 재전송은 수신 run 하나만 만들고 멈춘 뒤에도 저장된 결과만 주며 다른 내용은 거절한다", async () => {
  const world = await open();
  try {
    const sender = await lophnRun(world);
    const first = await submit(world, sender, submission(world));
    assertEquals(first.status, 200, JSON.stringify(first.body));
    const runs = runsCount(world);
    const firstSeq = ((first.body["result"] ?? first.body) as {
      accepted_seq: string;
    }).accepted_seq;
    // 전송 idempotency key와 별개로 (보낸 run, 중복 방지 key)가 접수 유일성이다.
    const replay = await submit(world, sender, submission(world));
    assertEquals(replay.status, 200, JSON.stringify(replay.body));
    const replayed = (replay.body["result"] ?? replay.body) as {
      receiver_run: string;
      accepted_seq: string;
      replayed: boolean;
    };
    assertEquals(replayed.replayed, true);
    assertEquals(replayed.receiver_run, RUN_B);
    assertEquals(replayed.accepted_seq, firstSeq);
    assertEquals(runsCount(world), runs);
    // 같은 key에 다른 내용은 접수 유일성을 깨므로 거절한다.
    const changed = await submit(
      world,
      sender,
      submission(world, {
        content: { ...CONTENT, what: "다른 일을 맡긴다" },
      }),
    );
    assertEquals(codeOf(changed), "conflict");
    // 재전송이 새 수신 run id를 들고 와도 먼저 접수한 run을 돌려주고 새 run은 없다.
    const moved = await submit(
      world,
      sender,
      submission(world, { receiver_run: RUN_C }),
    );
    assertEquals(moved.status, 200, JSON.stringify(moved.body));
    assertEquals(moved.body["receiver_run"], RUN_B);
    assertEquals(moved.body["replayed"], true);
    assertEquals(
      count(world.server, "select count(*) as n from runs where id = ?", [
        RUN_C,
      ]),
      0,
    );
    assertEquals(runsCount(world), runs);

    // 받는 assignment가 멈춰도 같은 요청의 replay는 저장된 결과를 준다(새 run은 없다).
    setAssignmentState(world.server.dataRoot, world.editor.id, "paused");
    const afterPause = await submit(world, sender, submission(world));
    assertEquals(afterPause.status, 200, JSON.stringify(afterPause.body));
    assertEquals(runsCount(world), runs);

    // 끝난 수신 run에 대한 멈춤은 기존 결과를 돌려주고 바꾸지 않는다(run-loop 규칙).
    setAssignmentState(world.server.dataRoot, world.editor.id, "enabled");
    await startRun(world, RUN_B, world.editor);
    const done = await finishRun(world, RUN_B);
    assertEquals(done.status, 200, JSON.stringify(done.body));
    const record = await readRun(world, RUN_B);
    const stop = await send(world, "runs/stop", world.user, {
      run: RUN_B,
      reason: "user_stopped",
      request_key: "stop-late",
    }, { state_seq: record.state_seq });
    assertEquals(stop.status, 200, JSON.stringify(stop.body));
    assertEquals(stop.body["replayed"], true);
    assertEquals(
      (await readRun(world, RUN_B)).state_seq,
      record.state_seq,
    );
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/run-loop#R7: 받은 run에서 보낸 run·원래 요청·맡긴 내용의 근거·고정 version을 확인하고 같은 handoff는 두 번 시작되지 않는다", async () => {
  const world = await open();
  try {
    const sender = await lophnRun(world);
    const sent = await submit(world, sender, submission(world));
    assertEquals(sent.status, 200, JSON.stringify(sent.body));
    const receiver = await agentFor(world, world.editor, RUN_B);
    // 받는 assignment의 agent가 자기 run의 출처를 읽는다.
    const run = await read(world, "runs/read", receiver, { run: RUN_B });
    assertEquals(run.status, 200, JSON.stringify(run.body));
    const source = (run.body["run"] as { source: Record<string, unknown> })
      .source;
    assertEquals(source["kind"], "handoff");
    assertEquals(source["sender_run"], RUN_A);
    assertEquals(source["original_message"], MSG_ONE);
    assertEquals(source["references"], [REFERENCE]);
    assertEquals(source["body"], handoffBodyHash(CONTENT));
    const bodyBytes = createHash("sha256")
      .update(canonicalize(CONTENT), "utf8")
      .digest("hex");
    assertEquals(source["body"], bodyBytes);
    // 다시 보내도 run은 둘이 되지 않는다.
    const once = count(
      world.server,
      "select count(*) as n from runs where source_kind = 'handoff'",
    );
    const replay = await submit(world, sender, submission(world));
    assertEquals(replay.status, 200, JSON.stringify(replay.body));
    assertEquals(
      count(
        world.server,
        "select count(*) as n from runs where source_kind = 'handoff'",
      ),
      once,
    );
  } finally {
    await world.dispose();
  }
});

// agent tool의 소유 contract 호출을 실제 core의 HTTP route로 잇는다. 호출 run에 묶인 자격으로만
// 부른다. 이 통로가 handoff.submit tool이 만든 run 계보를 실제 ledger에 남긴다.
function corePorts(
  world: World,
  tokens: ReadonlyMap<string, string>,
): AgentToolPorts {
  let next = 40;
  return {
    async call(contract, input, run) {
      const route = ROUTES.find((candidate) => candidate.name === contract);
      assert(route !== undefined, contract);
      const token = tokens.get(run);
      assert(token !== undefined, run);
      const path = `${route.resource}/${route.method}`;
      const reply = route.kind === "command"
        ? await send(world, path, token, input)
        : await read(world, path, token, input);
      return reply.status === 200 ? { ok: true as const, value: reply.body } : {
        ok: false as const,
        error: {
          code: (codeOf(reply) ?? "internal") as "internal",
          message: "core refused",
        },
      };
    },
    newId: (prefix) => id(prefix, next++),
    async runFacts(run) {
      const token = tokens.get(run);
      assert(token !== undefined, run);
      const record = await read(world, "runs/read", token, { run });
      assertEquals(record.status, 200, JSON.stringify(record.body));
      const runRecord = record.body["run"] as {
        assignment: string;
        session: string | null;
        source: { kind: string; message?: string; original_message?: string };
      };
      const assignment = await read(world, "assignments/read", token, {
        assignment: runRecord.assignment,
      });
      assertEquals(assignment.status, 200, JSON.stringify(assignment.body));
      return {
        ok: true as const,
        value: {
          session: runRecord.session,
          role: (assignment.body["assignment"] as { role: "lophn" }).role,
          original_message: runRecord.source.kind === "message"
            ? runRecord.source.message ?? null
            : runRecord.source.original_message ?? null,
          assignment: runRecord.assignment,
        },
      };
    },
  };
}

Deno.test("lophn-agent/handoff#R7: handoff.submit tool이 만든 run 계보에서 사람이 거절한 같은 동작은 받은 역할이 다시 묻지 못한다", async () => {
  const world = await open();
  try {
    const sender = await lophnRun(world);
    const names = AGENT_TOOLS.map((tool) => tool.name);
    const listed = listTools(
      { builtin: BUILTIN_TOOLS, app: [], external: [] },
      { presetTools: names, roleTools: names },
    );
    const deps = (ports: AgentToolPorts) => ({
      listed,
      handlers: createAgentToolHandlers(ports),
      credential: {
        run: RUN_A,
        targets: new Set<string>(),
        operations: new Set(AGENT_TOOLS.map((tool) => tool.contract)),
      },
    });
    const ports = corePorts(world, new Map([[RUN_A, sender]]));
    const handed = await executeTool(deps(ports), "handoff.submit", {
      receiver_assignment: world.editor.id,
      to_role: "context_engineer",
      ...CONTENT,
      references: [REFERENCE],
      dedup_key: "by-tool",
    });
    assertEquals(handed.outcome.kind, "success", JSON.stringify(handed.result));
    const receiverRun = (handed.result.content as { receiver_run: string })
      .receiver_run;
    // tool이 만든 run은 받는 assignment의 독립 run이고 계보는 보낸 run·원래 요청을 가리킨다.
    const record = await readRun(world, receiverRun);
    assertEquals(record.state, "accepted");
    assertEquals(record.source["kind"], "handoff");
    assertEquals(record.source["sender_run"], RUN_A);
    assertEquals(record.source["original_message"], MSG_ONE);
    assertEquals(record.source["dedup_key"], "by-tool");
    assertEquals(
      inspect(world.server, "select assignment from runs where id = ?", [
        receiverRun,
      ])[0]?.["assignment"],
      world.editor.id,
    );
    // 같은 tool 호출을 다시 해도 수신 run은 하나다(새 수신 run id를 만들어도 같은 key는 같다).
    const again = await executeTool(deps(ports), "handoff.submit", {
      receiver_assignment: world.editor.id,
      to_role: "context_engineer",
      ...CONTENT,
      references: [REFERENCE],
      dedup_key: "by-tool",
    });
    assertEquals(again.outcome.kind, "success");
    const replayed = again.result.content as {
      receiver_run: string;
      replayed: boolean;
    };
    assertEquals(replayed.receiver_run, receiverRun);
    assertEquals(replayed.replayed, true);
    assertEquals(
      count(
        world.server,
        "select count(*) as n from runs where source_kind = 'handoff'",
      ),
      1,
    );

    // 보낸 run의 거절은 받은 run에서도 적용된다.
    const a = `agent:${world.lophn.id}`;
    const b = `agent:${world.editor.id}`;
    const first = await call(
      world.server,
      "approvals/create",
      sender,
      command(
        await createInput(id("apr", 1), a, await action(a, "first"), {
          run: RUN_A,
          reason: "처음 묻는다",
        }),
      ),
    );
    assertEquals(first.status, 200, JSON.stringify(first.body));
    const rejected = await decide(
      world.server,
      world.user,
      first.body["request"] as ApprovalRequest,
      "reject",
    );
    assertEquals(rejected.status, 200, JSON.stringify(rejected.body));
    const receiver = await agentFor(world, world.editor, receiverRun);
    const handedOff = await call(
      world.server,
      "approvals/create",
      receiver,
      command(
        await createInput(id("apr", 2), b, await action(b, "first"), {
          run: receiverRun,
          reason: "넘겨받은 일이라 묻는다",
        }),
      ),
    );
    assertEquals(handedOff.status, 409, JSON.stringify(handedOff.body));
    assertEquals(
      (handedOff.body["error"] as { details?: { rejected_approval?: string } })
        .details?.rejected_approval,
      id("apr", 1),
    );
    assertEquals(count(world.server, REQUESTS), 1);
    // 새 사람 요청의 run은 막지 않는다.
    await acceptMessageRun(world, RUN_C, world.lophn, MSG_TWO);
    const fresh = await agentFor(world, world.lophn, RUN_C);
    const allowed = await call(
      world.server,
      "approvals/create",
      fresh,
      command(
        await createInput(id("apr", 3), a, await action(a, "first"), {
          run: RUN_C,
          reason: "새 요청이라 묻는다",
        }),
      ),
    );
    assertEquals(allowed.status, 200, JSON.stringify(allowed.body));
  } finally {
    await world.dispose();
  }
});
