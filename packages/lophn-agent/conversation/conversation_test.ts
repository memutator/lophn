import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../base/mod.ts";
import type {
  AuthenticatedContext,
  SqlRow,
} from "../../contracts/platform/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../apps/core/testing/ledger.ts";
import {
  envelope,
  presetDefinitionJson,
} from "../harness/run-loop/testing/mod.ts";
import {
  BODY,
  bodyHashOf,
  cred,
  hashOf,
  id,
  textContent,
} from "./testing/mod.ts";

// 세션·메시지 ledger 테스트. 실제 등록 executor(harness)와 임시 ledger 파일을 쓰고
// run-loop의 FinishRun이 제품 core와 같은 hasUnappliedSteering(messages 표)을 본다.
// 재시작과 30일 유휴는 파일 ledger를 닫고 다시 여는 apps/core/testing/
// lophn-agent-conversation_test.ts의 R2 시험이 맡는다.
// 실제 provider를 부르지 않는다.

const NOW = Date.UTC(2026, 0, 1);

const userCred = cred("user");
const machineCred = cred("machine");
const ASG_LOPHN = id("asg", 1);
const ASG_CE = id("asg", 2);
const ASG_AE = id("asg", 3);
const ASG_OP = id("asg", 4);
const APP = id("app", 1);
const APP_OTHER = id("app", 2);
const PROJECT = id("prj", 1);
const PROJECT_OTHER = id("prj", 2);
const PVDR = id("pvd", 1);
const BASIS = "b".repeat(64);
const RESULT = "c".repeat(64);
const LIMITS = { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 };
const DONE = { kind: "completed", reason: "answer_completed" };
const FAILED = { kind: "failed", reason: "model_error" };

const agentOf = (assignment: string) => cred(`agent:${assignment}`);

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function code(result: Result<unknown>, expected: string) {
  if (result.ok) {
    assert(false, "expected failure, got " + JSON.stringify(result.value));
  } else {
    assertEquals(result.error.code, expected);
  }
}

// command 결과의 본문. harness는 stored result 안에 출력을 담는다.
type Snapshot = {
  message: Record<string, unknown>;
  created_seq: string;
  state_seq: string;
};
function output<T>(result: Result<{ result: unknown }>): T {
  return value(result).result as T;
}

async function open(): Promise<LedgerHarness> {
  const opened = await createLedgerHarness({
    registrationModules: [
      new URL("../harness/provider/registration_test.ts", import.meta.url),
      new URL("../harness/usage/registration_test.ts", import.meta.url),
      new URL("./registration_test.ts", import.meta.url),
    ],
    credentials: [
      userCred,
      machineCred,
      agentOf(ASG_LOPHN),
      agentOf(ASG_CE),
      agentOf(ASG_AE),
      cred(`coding_agent:${id("cac", 1)}`),
    ],
    nowMs: NOW,
  });
  assert(opened.ok, opened.ok ? undefined : JSON.stringify(opened.error));
  return opened.value;
}

async function sql(
  h: LedgerHarness,
  query: string,
  params: readonly (string | number | bigint)[] = [],
): Promise<SqlRow[]> {
  return value(await h.inspect(query, params));
}

async function count(h: LedgerHarness, table: string, where = "1 = 1") {
  const row =
    (await sql(h, `select count(*) as n from ${table} where ${where}`))[
      0
    ]!;
  return Number(row["n"]);
}

async function seed(h: LedgerHarness) {
  for (
    const kind of ["lophn", "context_engineer", "app_engineer", "operator"]
  ) {
    const definition = presetDefinitionJson(kind);
    value(
      await h.command(
        machineCred,
        envelope("RegisterDefaultPreset", {
          id: id("pst", kind.length),
          definition,
          definition_hash: hashOf(definition),
        }),
      ),
    );
  }
  for (
    const [assignment, kind] of [
      [ASG_LOPHN, "lophn"],
      [ASG_CE, "context_engineer"],
    ] as const
  ) {
    value(
      await h.command(
        machineCred,
        envelope("CreateBuiltinAssignment", {
          id: assignment,
          preset: id("pst", kind.length),
          preset_revision: 1,
          role: kind,
          scope: { kind: "all", id: null },
        }),
      ),
    );
  }
  const appCreated = output<{ seq: string }>(
    await h.command(
      machineCred,
      envelope("SeedTargetFixture", { type: "AppCreated", subject: APP }),
    ),
  );
  value(
    await h.command(
      machineCred,
      envelope("CreateAppEngineerAssignment", {
        id: ASG_AE,
        app_created_seq: appCreated.seq,
        app: APP,
        preset: id("pst", "app_engineer".length),
        preset_revision: 1,
      }),
    ),
  );
  value(
    await h.command(
      machineCred,
      envelope("SeedOperatorFixture", {
        id: ASG_OP,
        preset: id("pst", "operator".length),
        scope_kind: "project",
        scope_id: PROJECT,
      }),
    ),
  );
  for (
    const [type, subject] of [
      ["ProjectCreated", PROJECT],
      ["ProjectCreated", PROJECT_OTHER],
      ["AppCreated", APP_OTHER],
    ] as const
  ) {
    value(
      await h.command(
        machineCred,
        envelope("SeedTargetFixture", { type, subject }),
      ),
    );
  }
}

async function assignmentOf(h: LedgerHarness, assignment: string) {
  const row = (await sql(
    h,
    "select revision, state from assignments where id = ?",
    [assignment],
  ))[0]!;
  return { revision: Number(row["revision"]), state: String(row["state"]) };
}

async function sessionSeq(h: LedgerHarness, session: string): Promise<string> {
  const row = (await sql(
    h,
    "select cast(state_seq as text) as seq from sessions where id = ?",
    [session],
  ))[0]!;
  return String(row["seq"]);
}

const PLACES = {
  global: { kind: "global", id: null },
  project: { kind: "project", id: PROJECT },
  app: { kind: "app", id: APP },
} as const;

type Place = { kind: string; id: string | null };

async function openSession(
  h: LedgerHarness,
  session: string,
  assignment: string,
  role: string,
  place: Place,
  from: { session: string; through_seq: string } | null = null,
  ctx = userCred,
) {
  const current = await assignmentOf(h, assignment);
  return h.command(
    ctx,
    envelope("OpenSession", {
      id: session,
      assignment,
      role,
      work_place: place,
      continued_from: from,
    }, {
      assignment_revision: current.revision,
      assignment_state: current.state,
    }),
  );
}

async function receive(
  h: LedgerHarness,
  input: {
    message: string;
    session: string;
    mode: "request" | "correction";
    run?: string;
    text?: string;
  },
  ctx = userCred,
) {
  const stored = (await sql(
    h,
    `select s.assignment as assignment from sessions s where s.id = ?`,
    [input.session],
  ))[0];
  const assignment = await assignmentOf(
    h,
    stored === undefined ? ASG_LOPHN : String(stored["assignment"]),
  );
  return h.command(
    ctx,
    envelope("ReceiveMessage", {
      id: input.message,
      session: input.session,
      content: textContent(input.text ?? `message ${input.message.length}`),
      mode: input.mode,
      ...(input.run === undefined ? {} : { run: input.run }),
    }, {
      session_state: "open",
      session_state_seq: stored === undefined
        ? "1"
        : await sessionSeq(h, input.session),
      assignment_revision: assignment.revision,
      assignment_state: assignment.state,
    }),
  );
}

async function runStateSeq(h: LedgerHarness, run: string): Promise<string> {
  const read = value(
    await h.read({ resource: "runs", method: "read" }, userCred, { run }),
  ) as { run: { state_seq: string } };
  return read.run.state_seq;
}

async function startRun(h: LedgerHarness, run: string, assignment: string) {
  const role = assignment === ASG_LOPHN
    ? "lophn"
    : assignment === ASG_CE
    ? "context_engineer"
    : "app_engineer";
  return h.command(
    machineCred,
    envelope("StartRun", {
      run,
      basis: BASIS,
      limits: LIMITS,
      scope: { role, assignment, apps: [] },
    }, { state_seq: await runStateSeq(h, run) }),
  );
}

async function finishRun(
  h: LedgerHarness,
  run: string,
  outcome: { kind: string; reason: string },
) {
  return h.command(
    machineCred,
    envelope("FinishRun", { run, outcome, result: RESULT }, {
      state_seq: await runStateSeq(h, run),
    }),
  );
}

async function messageRow(h: LedgerHarness, message: string) {
  return (await sql(
    h,
    `select id, session, actor, body, run, mode, applied_at_call, links
     from messages where id = ?`,
    [message],
  ))[0];
}

async function runOf(h: LedgerHarness, message: string): Promise<string> {
  const row = await messageRow(h, message);
  assert(row !== undefined && row["run"] !== null, "message has no run");
  return String(row["run"]);
}

async function eventsOf(h: LedgerHarness, type: string, subject?: string) {
  return await sql(
    h,
    subject === undefined
      ? "select seq, subject, payload from events where type = ? order by seq"
      : "select seq, subject, payload from events where type = ? and subject = ? order by seq",
    subject === undefined ? [type] : [type, subject],
  );
}

// 사람 요청 하나로 세션과 시작한 run 하나를 만든다.
async function openLophn(h: LedgerHarness, session = id("ses", 1)) {
  value(await openSession(h, session, ASG_LOPHN, "lophn", PLACES.global));
  return session;
}

async function runningRun(
  h: LedgerHarness,
  session: string,
  message: string,
  assignment = ASG_LOPHN,
): Promise<string> {
  value(await receive(h, { message, session, mode: "request" }));
  const run = await runOf(h, message);
  value(await startRun(h, run, assignment));
  return run;
}

// model call 하나를 시작한다. 입력 반영(ApplyMessages)이 가리킬 call이다.
const price = {
  currency: "USD" as const,
  rates: [{
    context_from: null,
    context_through: null,
    cache_ttl_ms: null,
    input: "3",
    output: "15",
    cache_read: "0.3",
    cache_write: "3.75",
    reasoning: "30",
  }],
  source: "models.dev",
  revision: "2026-10",
  checked_at: "2026-10-05T00:00:00.000Z",
};

async function seedProvider(h: LedgerHarness) {
  value(
    await h.command(
      userCred,
      envelope("RegisterProvider", {
        id: PVDR,
        name: "Loopback provider",
        definition: {
          key: "ollama",
          display_name: "Ollama",
          protocols: ["openai-responses"],
          auth_kinds: ["none"],
          models_endpoint: null,
          oauth: null,
          revision: "2026-01-01",
        },
        endpoint: "http://127.0.0.1:8080/v1",
        protocol: "openai-responses",
      }),
    ),
  );
}

function startCall(
  h: LedgerHarness,
  call: string,
  run: string,
  session: string,
  attempt = 1,
) {
  const started = {
    id: call,
    run,
    session,
    model_use: "judgment",
    preset: { id: id("pst", 1), revision: 1 },
    purpose: "judgment",
    test_request: null,
    attempt_kind: "initial",
    attempt_order: attempt,
    retry_of: null,
    credential_change_of: null,
    model: {
      provider: PVDR,
      name: "gpt",
      protocol: "openai-responses",
      credential_key: null,
      credential_revision: null,
      options: {},
      requested_reasoning: "provider_default",
      applied_reasoning: null,
      limits: {
        context_limit: 128000,
        input_limit: 120000,
        output_limit: 8000,
        supports_tools: true,
      },
      catalog_basis: { source: "models_dev" },
      price_basis: price,
      billing_route: "api",
    },
    input: BODY(7),
    context_basis: BODY(8),
    output: null,
    state: "started",
    started_at: "2026-01-01T00:00:00.000Z",
    finished_at: null,
    duration_ms: null,
    first_output_ms: null,
    outcome: null,
    usage: {
      input: null,
      output: null,
      cache_read: null,
      cache_write: null,
      reasoning: null,
      cache_in_input: null,
      reasoning_in_output: null,
      definition_revision: "2026-10",
    },
    cost: {
      kind: "unknown",
      amount: null,
      currency: null,
      basis: null,
      confirmed_at: null,
    },
  };
  return h.command(
    machineCred,
    envelope("StartModelCall", {
      call: started,
      applied_messages: [],
      state_seq: "4",
      timeout_ms: null,
    }, { state_seq: "4" }),
  );
}

function applyMessages(
  h: LedgerHarness,
  messages: string[],
  call: string,
) {
  return h.command(
    machineCred,
    envelope("ApplyMessages", { messages, call }, { applied_at_call: null }),
  );
}

Deno.test("lophn-agent/conversation#R1: a new session starts empty for one person and one assignment, and the work place is fixed by role", async () => {
  const h = await open();
  try {
    await seed(h);
    // 네 역할 모두 직접 열 수 있다. AE는 담당 app, Operator는 담당 project로 고정이다.
    const lophn = output<
      { id: string; state: string; work_place_revision: number }
    >(
      await openSession(h, id("ses", 1), ASG_LOPHN, "lophn", PLACES.global),
    );
    assertEquals(lophn.state, "open");
    assertEquals(lophn.work_place_revision, 1);
    value(
      await openSession(
        h,
        id("ses", 2),
        ASG_CE,
        "context_engineer",
        PLACES.project,
      ),
    );
    value(
      await openSession(h, id("ses", 3), ASG_AE, "app_engineer", PLACES.app),
    );
    value(
      await openSession(h, id("ses", 4), ASG_OP, "operator", PLACES.project),
    );
    // 빈 세션이다. 다른 역할 세션의 요약이나 원문이 자동으로 들어오지 않는다.
    assertEquals(await count(h, "messages"), 0);
    for (const n of [1, 2, 3, 4]) {
      const read = value(
        await h.read({ resource: "sessions", method: "read" }, userCred, {
          session: id("ses", n),
        }),
      ) as { session: { continued_from: unknown; state: string } };
      assertEquals(read.session.continued_from, null);
      assertEquals(read.session.state, "open");
    }
    // 역할을 바꿔 시작하려면 다른 assignment의 새 세션이며 상대는 고정이다.
    code(
      await openSession(
        h,
        id("ses", 5),
        ASG_LOPHN,
        "context_engineer",
        PLACES.global,
      ),
      "invalid_input",
    );
    // 범위 밖 자리는 고정 역할에서 거절한다.
    code(
      await openSession(h, id("ses", 5), ASG_AE, "app_engineer", {
        kind: "app",
        id: APP_OTHER,
      }),
      "forbidden",
    );
    code(
      await openSession(h, id("ses", 5), ASG_OP, "operator", {
        kind: "project",
        id: PROJECT_OTHER,
      }),
      "forbidden",
    );
    // 전역·잘못된 짝은 입력 계약이 먼저 거절한다.
    code(
      await openSession(h, id("ses", 5), ASG_AE, "app_engineer", PLACES.global),
      "invalid_input",
    );
    // 같은 id의 같은 요청은 같은 세션이고 다른 내용은 충돌이다.
    assertEquals(
      output<{ id: string }>(
        await openSession(h, id("ses", 1), ASG_LOPHN, "lophn", PLACES.global),
      ).id,
      id("ses", 1),
    );
    code(
      await openSession(
        h,
        id("ses", 1),
        ASG_CE,
        "context_engineer",
        PLACES.global,
      ),
      "conflict",
    );
    assertEquals(await count(h, "sessions"), 4);
    // 사람만 세션을 연다.
    code(
      await openSession(
        h,
        id("ses", 6),
        ASG_LOPHN,
        "lophn",
        PLACES.global,
        null,
        machineCred,
      ),
      "forbidden",
    );
    // 열린 세션 수 상한이 없다. 같은 assignment의 세션이 여러 개다.
    for (const n of [7, 8, 9, 10, 11, 12, 13, 14, 15]) {
      value(
        await openSession(h, id("ses", n), ASG_LOPHN, "lophn", PLACES.global),
      );
    }
    assertEquals(
      await count(h, "sessions", `assignment = '${ASG_LOPHN}'`),
      10,
    );
    assertEquals(await count(h, "sessions", "state = 'open'"), 13);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R1: a withdrawn assignment takes no new session and an unknown assignment is not found", async () => {
  const h = await open();
  try {
    await seed(h);
    value(
      await h.command(
        userCred,
        envelope("WithdrawAssignment", { assignment: ASG_AE }, {
          revision: 1,
          state: "enabled",
        }),
      ),
    );
    // 회수된 assignment는 compare가 어떤 값이든 새 세션을 받지 않는다.
    code(
      await h.command(
        userCred,
        envelope("OpenSession", {
          id: id("ses", 1),
          assignment: ASG_AE,
          role: "app_engineer",
          work_place: PLACES.app,
          continued_from: null,
        }, { assignment_revision: 2, assignment_state: "enabled" }),
      ),
      "forbidden",
    );
    code(
      await h.command(
        userCred,
        envelope("OpenSession", {
          id: id("ses", 1),
          assignment: id("asg", 30),
          role: "lophn",
          work_place: PLACES.global,
          continued_from: null,
        }, { assignment_revision: 1, assignment_state: "enabled" }),
      ),
      "not_found",
    );
    assertEquals(await count(h, "sessions"), 0);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R3: a message sent while a run is going is received at once and shown applied only after a model call includes it", async () => {
  const h = await open();
  try {
    await seed(h);
    await seedProvider(h);
    const session = await openLophn(h);
    const run = await runningRun(h, session, id("msg", 1));
    const received = output<Snapshot>(
      await receive(h, {
        message: id("msg", 2),
        session,
        mode: "correction",
        run,
      }),
    );
    // 접수와 담당 run이 같이 남고 최초 반영은 비어 있다.
    assertEquals(received.message["run"], run);
    assertEquals(received.message["mode"], "correction");
    assertEquals(received.message["applied_at_call"], null);
    assertEquals(
      (await eventsOf(h, "MessageReceived", id("msg", 2))).length,
      1,
    );
    assertEquals((await eventsOf(h, "MessageApplied")).length, 0);
    // 접수만으로 run을 끝내거나 멈추지 않는다.
    assertEquals(
      String(
        (await sql(h, "select state from runs where id = ?", [run]))[0]![
          "state"
        ],
      ),
      "running",
    );
    // 입력 접수는 수정·멈춤 완료 표시가 아니다. 반영은 model call 뒤에만 있다.
    value(await startCall(h, id("mcl", 1), run, session));
    const listed = value(
      await h.read({ resource: "messages", method: "list" }, userCred, {
        session,
        run,
      }),
    ) as { messages: Snapshot[] };
    assertEquals(
      listed.messages.map((entry) => entry.message["applied_at_call"]),
      [null, null],
    );
    const applied = output<{ messages: Snapshot[] }>(
      await applyMessages(h, [id("msg", 2)], id("mcl", 1)),
    );
    assertEquals(applied.messages[0]!.message["applied_at_call"], id("mcl", 1));
    assertEquals((await eventsOf(h, "MessageApplied", id("msg", 2))).length, 1);
    // 최초 반영은 한 번이다. 다른 call로 다시 반영하지 못한다.
    value(await startCall(h, id("mcl", 2), run, session, 2));
    code(await applyMessages(h, [id("msg", 2)], id("mcl", 2)), "conflict");
    // 같은 call 재전송은 이전 결과다.
    value(await applyMessages(h, [id("msg", 2)], id("mcl", 1)));
    assertEquals((await eventsOf(h, "MessageApplied")).length, 1);
    // 다른 run의 call이나 없는 call은 반영하지 못한다.
    code(await applyMessages(h, [id("msg", 2)], id("mcl", 9)), "not_found");
    // 사람만 접수하고 machine만 반영한다.
    code(
      await receive(h, {
        message: id("msg", 3),
        session,
        mode: "request",
      }, machineCred),
      "forbidden",
    );
    code(
      await h.command(
        userCred,
        envelope("ApplyMessages", {
          messages: [id("msg", 1)],
          call: id("mcl", 1),
        }, {
          applied_at_call: null,
        }),
      ),
      "forbidden",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R3: receiving a message and accepting its run are one transaction", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    value(
      await h.command(
        machineCred,
        envelope("SeedAcceptFailure", { fail: true }),
      ),
    );
    code(
      await receive(h, { message: id("msg", 1), session, mode: "request" }),
      "conflict",
    );
    // 접수가 실패하면 메시지도 event도 남지 않는다.
    assertEquals(await count(h, "messages"), 0);
    assertEquals(await count(h, "runs"), 0);
    assertEquals((await eventsOf(h, "MessageReceived")).length, 0);
    assertEquals((await eventsOf(h, "RunAccepted")).length, 0);
    value(
      await h.command(
        machineCred,
        envelope("SeedAcceptFailure", { fail: false }),
      ),
    );
    const snapshot = output<Snapshot>(
      await receive(h, { message: id("msg", 1), session, mode: "request" }),
    );
    // 접수 완료를 돌려줄 때 담당 run이 이미 같은 commit에 있다.
    const run = String(snapshot.message["run"]);
    const source =
      (await sql(h, "select source_message, session from runs where id = ?", [
        run,
      ]))[0]!;
    assertEquals(String(source["source_message"]), id("msg", 1));
    assertEquals(String(source["session"]), session);
    assertEquals((await eventsOf(h, "RunAccepted", run)).length, 1);
    // 같은 id 재전송(다른 idempotency key)은 같은 메시지와 같은 run 하나다.
    const again = output<Snapshot>(
      await receive(h, { message: id("msg", 1), session, mode: "request" }),
    );
    assertEquals(again.message["run"], run);
    assertEquals(await count(h, "runs"), 1);
    assertEquals(await count(h, "messages"), 1);
    // 같은 id의 다른 내용은 충돌이고 run을 더 만들지 않는다.
    code(
      await receive(h, {
        message: id("msg", 1),
        session,
        mode: "request",
        text: "another body for the same id",
      }),
      "conflict",
    );
    assertEquals(await count(h, "runs"), 1);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R4: speakers stay distinct and a message links only real targets", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const run = await runningRun(h, session, id("msg", 1));
    const doc = id("doc", 1);
    const ver = id("ver", 1);
    const body = textContent("a plan without links");
    // agent 자격의 기록(자기 run 묶음·다른 assignment 거절)은 apps/core/testing/
    // lophn-agent-conversation_test.ts가 platform의 run 판정과 함께 본다.
    const record = (
      message: string,
      links: unknown[],
      ctx: AuthenticatedContext = machineCred,
      target: string | null = run,
    ) =>
      h.command(
        ctx,
        envelope("RecordMessage", {
          id: message,
          session,
          run: target,
          content: body,
          links,
        }),
      );
    // 계획만 있는 답에는 생성 링크가 없다. 아직 없는 문서·version은 링크가 될 수 없다.
    const plan = output<Snapshot>(await record(id("msg", 2), []));
    assertEquals(plan.message["links"], []);
    code(
      await record(id("msg", 3), [{ kind: "document", document: doc }]),
      "invalid_input",
    );
    code(
      await record(
        id("msg", 3),
        [{ kind: "version", document: doc, version: ver }],
      ),
      "invalid_input",
    );
    // 실제 문서가 생기고 version이 저장된 뒤에는 그 링크를 남긴다.
    value(
      await h.command(
        machineCred,
        envelope("SeedTargetFixture", {
          type: "DocumentCreated",
          subject: doc,
          payload: { version: ver },
        }),
      ),
    );
    const linked = output<Snapshot>(
      await record(id("msg", 3), [
        { kind: "document", document: doc },
        { kind: "version", document: doc, version: ver },
      ]),
    );
    assertEquals((linked.message["links"] as unknown[]).length, 2);
    // 다른 문서의 version은 이 문서의 링크가 아니다.
    code(
      await record(
        id("msg", 4),
        [{ kind: "version", document: id("doc", 2), version: ver }],
      ),
      "invalid_input",
    );
    // 같은 id의 같은 기록은 이전 결과이고 다른 링크는 충돌이다.
    value(
      await record(id("msg", 3), [
        { kind: "document", document: doc },
        { kind: "version", document: doc, version: ver },
      ]),
    );
    code(
      await record(id("msg", 3), [{ kind: "document", document: doc }]),
      "conflict",
    );
    assertEquals(await count(h, "messages"), 3);
    // 발언자: 사람과 machine 확인 사실이 구분된다.
    const listed = value(
      await h.read({ resource: "messages", method: "list" }, userCred, {
        session,
      }),
    ) as { messages: Snapshot[] };
    assertEquals(
      listed.messages.map((
        entry,
      ) => [
        entry.message["id"],
        entry.message["actor"],
        entry.message["mode"],
      ]),
      [
        [id("msg", 1), "user", "request"],
        [id("msg", 2), "machine", null],
        [id("msg", 3), "machine", null],
      ],
    );
    // 각 발언에 시각 대신 쓰는 생성 순번이 있고 순서가 곧 발언 순서다.
    const seqs = listed.messages.map((entry) => BigInt(entry.created_seq));
    assertEquals([...seqs].sort((a, b) => (a < b ? -1 : 1)), seqs);
    // 사람은 기록 command를 쓰지 못한다.
    code(await record(id("msg", 6), [], userCred), "forbidden");
    // 다른 세션의 run에는 붙이지 못한다.
    const other = await openLophn(h, id("ses", 2));
    value(
      await receive(h, {
        message: id("msg", 7),
        session: other,
        mode: "request",
      }),
    );
    code(
      await record(id("msg", 8), [], machineCred, await runOf(h, id("msg", 7))),
      "invalid_input",
    );
    assertEquals(await count(h, "messages"), 4);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R4 [ctx-I58j]: a context link needs a context that was created", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const run = await runningRun(h, session, id("msg", 1));
    const ctx = id("ctx", 1);
    const record = (message: string, links: unknown[]) =>
      h.command(
        machineCred,
        envelope("RecordMessage", {
          id: message,
          session,
          run,
          content: textContent("a context to look at"),
          links,
        }),
      );
    // 아직 없는 context는 링크가 될 수 없다.
    code(
      await record(id("msg", 2), [{ kind: "context", context: ctx }]),
      "invalid_input",
    );
    value(
      await h.command(
        machineCred,
        envelope("SeedTargetFixture", {
          type: "ContextCreated",
          subject: ctx,
          payload: {},
        }),
      ),
    );
    const linked = output<Snapshot>(
      await record(id("msg", 2), [{ kind: "context", context: ctx }]),
    );
    assertEquals(linked.message["links"], [{ kind: "context", context: ctx }]);
    // 다른 context의 링크는 이 context의 것이 아니다.
    code(
      await record(id("msg", 3), [{ kind: "context", context: id("ctx", 2) }]),
      "invalid_input",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R5: corrections keep their receipt order and a correction differs from a next request", async () => {
  const h = await open();
  try {
    await seed(h);
    await seedProvider(h);
    const session = await openLophn(h);
    const run = await runningRun(h, session, id("msg", 1));
    value(
      await receive(h, {
        message: id("msg", 2),
        session,
        mode: "correction",
        run,
      }),
    );
    value(
      await receive(h, {
        message: id("msg", 3),
        session,
        mode: "correction",
        run,
      }),
    );
    // 수정은 새 run을 만들지 않고 같은 run에 접수 순서로 남는다.
    assertEquals(await count(h, "runs"), 1);
    const listed = value(
      await h.read({ resource: "messages", method: "list" }, userCred, {
        session,
        run,
      }),
    ) as { messages: Snapshot[] };
    assertEquals(
      listed.messages.map((
        entry,
      ) => [entry.message["id"], entry.message["mode"]]),
      [
        [id("msg", 1), "request"],
        [id("msg", 2), "correction"],
        [id("msg", 3), "correction"],
      ],
    );
    // 다음 일은 따로 보존하는 다음 요청이고 현재 run의 수정이 아니다.
    const next = output<Snapshot>(
      await receive(h, { message: id("msg", 4), session, mode: "request" }),
    );
    assert(next.message["run"] !== run);
    assertEquals(await count(h, "runs"), 2);
    // 수정은 수정할 run이 필요하고 다음 일은 대상 run을 받지 않는다.
    code(
      await receive(h, { message: id("msg", 5), session, mode: "correction" }),
      "invalid_input",
    );
    code(
      await receive(h, {
        message: id("msg", 5),
        session,
        mode: "request",
        run,
      }),
      "invalid_input",
    );
    // 다른 세션·없는 run은 없는 run과 같다.
    const other = await openLophn(h, id("ses", 2));
    code(
      await receive(h, {
        message: id("msg", 5),
        session: other,
        mode: "correction",
        run,
      }),
      "not_found",
    );
    // 미반영 수정이 둘 있는 동안 정상 종료는 막히고, 모두 반영한 뒤에 끝난다.
    value(await startCall(h, id("mcl", 1), run, session));
    value(await startCall(h, id("mcl", 2), run, session, 2));
    value(await applyMessages(h, [id("msg", 2)], id("mcl", 1)));
    code(await finishRun(h, run, DONE), "conflict");
    value(await applyMessages(h, [id("msg", 3)], id("mcl", 2)));
    value(await finishRun(h, run, DONE));
    // 다음 일 요청은 정상 종료를 막지 않았다(그 run의 자기 요청은 반영 대상이 아니다).
    assertEquals(
      String(
        (await sql(h, "select outcome_kind from runs where id = ?", [run]))[0]![
          "outcome_kind"
        ],
      ),
      "completed",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R6: follow-up requests keep their order, each gets its own run and a failed or stopped run starts none by itself", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const first = await runningRun(h, session, id("msg", 1));
    value(
      await receive(h, { message: id("msg", 2), session, mode: "request" }),
    );
    value(
      await receive(h, { message: id("msg", 3), session, mode: "request" }),
    );
    const second = await runOf(h, id("msg", 2));
    const third = await runOf(h, id("msg", 3));
    // 접수 순서대로 선행 run이 이어지고 현재 일과 분리해 보존한다.
    const chain = await sql(
      h,
      "select id, start_after, source_message from runs order by accepted_seq",
    );
    assertEquals(
      chain.map((
        row,
      ) => [row["id"], row["start_after"], row["source_message"]]),
      [
        [first, null, id("msg", 1)],
        [second, first, id("msg", 2)],
        [third, second, id("msg", 3)],
      ],
    );
    // 현재 일이 끝나기 전에는 다음 일이 시작하지 못한다.
    code(await startRun(h, second, ASG_LOPHN), "conflict");
    // 실패한 일 뒤에는 사람이 확인하기 전까지 다음 일이 자동으로 시작하지 않는다.
    value(await finishRun(h, first, FAILED));
    code(await startRun(h, second, ASG_LOPHN), "conflict");
    value(
      await h.command(
        userCred,
        envelope("ConfirmNextRun", { run: second, predecessor: first }, {
          accepted_seq: String(
            (await sql(
              h,
              "select cast(accepted_seq as text) as s from runs where id = ?",
              [second],
            ))[0]!["s"],
          ),
          predecessor_state_seq: await runStateSeq(h, first),
        }),
      ),
    );
    value(await startRun(h, second, ASG_LOPHN));
    // 정상 종료 뒤에는 다음 접수가 확인 없이 시작한다.
    value(await finishRun(h, second, DONE));
    value(await startRun(h, third, ASG_LOPHN));
    assertEquals(await count(h, "runs", "state = 'running'"), 1);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R6: a stopped run leaves the next request waiting", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const first = await runningRun(h, session, id("msg", 1));
    value(
      await receive(h, { message: id("msg", 2), session, mode: "request" }),
    );
    const second = await runOf(h, id("msg", 2));
    value(
      await h.command(
        userCred,
        envelope("StopRun", {
          run: first,
          request_key: "stop-1",
          reason: "user_stopped",
        }, {
          state_seq: await runStateSeq(h, first),
        }),
      ),
    );
    code(await startRun(h, second, ASG_LOPHN), "conflict");
    assertEquals(
      String(
        (await sql(h, "select state from runs where id = ?", [second]))[0]![
          "state"
        ],
      ),
      "accepted",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R7: a correction that arrives before the end joins the running run and blocks a normal end until applied", async () => {
  const h = await open();
  try {
    await seed(h);
    await seedProvider(h);
    const session = await openLophn(h);
    const run = await runningRun(h, session, id("msg", 1));
    // 끝나기 직전에 도착한 수정이 있으면 정상 종료는 거절이다(FinishRun).
    value(
      await receive(h, {
        message: id("msg", 2),
        session,
        mode: "correction",
        run,
      }),
    );
    code(await finishRun(h, run, DONE), "conflict");
    assertEquals(
      String(
        (await sql(h, "select state from runs where id = ?", [run]))[0]![
          "state"
        ],
      ),
      "running",
    );
    // 반영 뒤에는 정상 종료가 확정된다. 수정은 그 run 하나에만 남았다.
    value(await startCall(h, id("mcl", 1), run, session));
    value(await applyMessages(h, [id("msg", 2)], id("mcl", 1)));
    value(await finishRun(h, run, DONE));
    assertEquals(await count(h, "runs"), 1);
    assertEquals(String((await messageRow(h, id("msg", 2)))!["run"]), run);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R7: a correction that arrives after the end gets exactly one new run and the finished run is not reopened", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const run = await runningRun(h, session, id("msg", 1));
    value(await finishRun(h, run, DONE));
    const before =
      (await sql(h, "select state, state_seq, result from runs where id = ?", [
        run,
      ]))[0]!;
    const late = output<Snapshot>(
      await receive(h, {
        message: id("msg", 2),
        session,
        mode: "correction",
        run,
      }),
    );
    const fresh = String(late.message["run"]);
    assert(fresh !== run);
    // 새 담당 run은 그 수정 메시지가 출처이고 끝난 run 뒤에 이어진다.
    const created = (await sql(
      h,
      "select source_message, start_after, state from runs where id = ?",
      [fresh],
    ))[0]!;
    assertEquals(String(created["source_message"]), id("msg", 2));
    assertEquals(String(created["start_after"]), run);
    assertEquals(String(created["state"]), "accepted");
    // 끝난 run은 그대로다.
    const after =
      (await sql(h, "select state, state_seq, result from runs where id = ?", [
        run,
      ]))[0]!;
    assertEquals(after, before);
    // 같은 수정의 재전송은 담당을 하나 더 만들지 않는다.
    const again = output<Snapshot>(
      await receive(h, {
        message: id("msg", 2),
        session,
        mode: "correction",
        run,
      }),
    );
    assertEquals(again.message["run"], fresh);
    assertEquals(await count(h, "runs"), 2);
    // 정상 종료한 선행 run 뒤라 새 담당 run은 곧바로 시작할 수 있다.
    value(await startRun(h, fresh, ASG_LOPHN));
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R7: a correction left on a run that ended unsuccessfully moves to exactly one new run", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const first = await runningRun(h, session, id("msg", 1));
    value(
      await receive(h, {
        message: id("msg", 2),
        session,
        mode: "correction",
        run: first,
      }),
    );
    // 정상 종료만 미반영 수정에 막힌다. 실패 종료는 그대로 확정된다.
    value(await finishRun(h, first, FAILED));
    value(
      await receive(h, { message: id("msg", 3), session, mode: "request" }),
    );
    const next = await runOf(h, id("msg", 3));
    const state = String((await messageRow(h, id("msg", 2)))!["run"]);
    assertEquals(state, first);
    const stateSeq = String(
      (await sql(
        h,
        "select cast(state_seq as text) as s from messages where id = ?",
        [id("msg", 2)],
      ))[0]!["s"],
    );
    const assign = (previous: string, run: string, seq = stateSeq) =>
      h.command(
        machineCred,
        envelope("AssignMessage", { message: id("msg", 2), run }, {
          previous_run: previous,
          message_state_seq: seq,
          applied_at_call: null,
        }),
      );
    // 사람은 보존한 담당을 옮기지 못하고 machine만 옮긴다.
    code(
      await h.command(
        userCred,
        envelope("AssignMessage", { message: id("msg", 2), run: next }, {
          previous_run: first,
          message_state_seq: stateSeq,
          applied_at_call: null,
        }),
      ),
      "forbidden",
    );
    // 이전 담당이 다르면 충돌이다. 같은 run으로의 이동은 입력 오류다.
    code(await assign(next, next), "invalid_input");
    code(await assign(first, next, "999999"), "conflict");
    const moved = output<Snapshot>(await assign(first, next));
    assertEquals(moved.message["run"], next);
    assertEquals(
      (await eventsOf(h, "MessageAssigned", id("msg", 2))).length,
      1,
    );
    // 같은 이동의 재전송은 이전 결과이고 담당은 하나다.
    value(await assign(first, next));
    assertEquals(
      (await eventsOf(h, "MessageAssigned", id("msg", 2))).length,
      1,
    );
    // 이미 끝난 run으로는 옮기지 못한다. 그 run의 다른 말은 다른 담당에 남지 않는다.
    const freshSeq = String(
      (await sql(
        h,
        "select cast(state_seq as text) as s from messages where id = ?",
        [id("msg", 2)],
      ))[0]!["s"],
    );
    code(await assign(next, first, freshSeq), "conflict");
    assertEquals(String((await messageRow(h, id("msg", 2)))!["run"]), next);
    // 요청은 수정처럼 옮기지 못한다.
    code(
      await h.command(
        machineCred,
        envelope("AssignMessage", { message: id("msg", 3), run: next }, {
          previous_run: next,
          message_state_seq: "1",
          applied_at_call: null,
        }),
      ),
      "invalid_input",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R8: closing needs finished runs and leaves the session read only, and a pause does not close it", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const run = await runningRun(h, session, id("msg", 1));
    // assignment 일시 멈춤은 종료가 아니다. 원문은 계속 읽고 세션은 열려 있다.
    value(
      await h.command(
        userCred,
        envelope("PauseAssignment", {
          assignment: ASG_LOPHN,
          reason: { kind: "user", detail: "잠시", runs: [], target: null },
        }, { revision: 1, state: "enabled" }),
      ),
    );
    const read = (user = userCred) =>
      h.read({ resource: "messages", method: "list" }, user, { session });
    assertEquals(
      (value(await read()) as { messages: unknown[] }).messages.length,
      1,
    );
    assertEquals(
      String(
        (await sql(h, "select state from sessions where id = ?", [session]))[
          0
        ]!["state"],
      ),
      "open",
    );
    value(
      await h.command(
        machineCred,
        envelope("StopRun", {
          run,
          request_key: "stop-paused",
          reason: "assignment_paused",
        }, {
          state_seq: await runStateSeq(h, run),
        }),
      ),
    );
    const close = async (
      ctx = userCred,
      reason = "user_closed",
      seq?: string,
    ) =>
      h.command(
        ctx,
        envelope("CloseSession", { session, reason }, {
          state_seq: seq ?? await sessionSeq(h, session),
          state: "open",
        }),
      );
    // 사람이 끝내는 종료는 미종료 run이 없을 때 한다. 낡은 CAS는 충돌이다.
    code(await close(userCred, "user_closed", "999999"), "conflict");
    // 사람은 user_closed, machine은 회수된 assignment의 이유만 쓴다.
    code(await close(userCred, "assignment_withdrawn"), "forbidden");
    code(await close(machineCred, "user_closed"), "forbidden");
    code(await close(machineCred, "assignment_withdrawn"), "forbidden");
    const closed = output<{ state: string; reason: string }>(await close());
    assertEquals(closed.state, "closed");
    assertEquals(closed.reason, "user_closed");
    assertEquals((await eventsOf(h, "SessionClosed", session)).length, 1);
    // 닫힌 세션은 새 입력을 거절하고 원문은 읽는다. 다시 열리지 않는다.
    code(
      await receive(h, { message: id("msg", 2), session, mode: "request" }),
      "forbidden",
    );
    code(
      await h.command(
        machineCred,
        envelope("RecordMessage", {
          id: id("msg", 3),
          session,
          run: null,
          content: textContent("late"),
          links: [],
        }),
      ),
      "forbidden",
    );
    assertEquals(
      (value(await read()) as { messages: unknown[] }).messages.length,
      1,
    );
    code(await close(), "conflict");
    const reopened = await h.probeWrite(
      "update sessions set state = 'open', closed_reason = null, closed_at = null where id = ?",
      [session],
    );
    assert(!reopened.ok, "a closed session must not reopen");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R8: a withdrawn assignment rejects new input and its session closes only after the runs are cleaned up", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = id("ses", 1);
    value(await openSession(h, session, ASG_AE, "app_engineer", PLACES.app));
    const run = await runningRun(h, session, id("msg", 1), ASG_AE);
    value(
      await h.command(
        userCred,
        envelope("WithdrawAssignment", { assignment: ASG_AE }, {
          revision: 1,
          state: "enabled",
        }),
      ),
    );
    // 세션이 아직 열려 있어도 회수된 assignment는 새 입력을 거절한다.
    code(
      await h.command(
        userCred,
        envelope("ReceiveMessage", {
          id: id("msg", 2),
          session,
          content: textContent("after withdrawn"),
          mode: "request",
        }, {
          session_state: "open",
          session_state_seq: await sessionSeq(h, session),
          assignment_revision: 2,
          assignment_state: "enabled",
        }),
      ),
      "forbidden",
    );
    const close = async () =>
      h.command(
        machineCred,
        envelope("CloseSession", { session, reason: "assignment_withdrawn" }, {
          state_seq: await sessionSeq(h, session),
          state: "open",
        }),
      );
    // 미종료 run이 남아 있는 동안은 닫지 않는다.
    code(await close(), "conflict");
    value(
      await h.command(
        machineCred,
        envelope("StopRun", {
          run,
          request_key: "stop-withdrawn",
          reason: "assignment_withdrawn",
        }, {
          state_seq: await runStateSeq(h, run),
        }),
      ),
    );
    const closed = output<{ reason: string }>(await close());
    assertEquals(closed.reason, "assignment_withdrawn");
    assertEquals(await count(h, "messages"), 1);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R8: a session of another assignment is absent for an agent and for a coding agent", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    value(
      await receive(h, { message: id("msg", 1), session, mode: "request" }),
    );
    const readSession = (ctx: AuthenticatedContext) =>
      h.read({ resource: "sessions", method: "read" }, ctx, { session });
    const listMessages = (ctx: AuthenticatedContext) =>
      h.read({ resource: "messages", method: "list" }, ctx, { session });
    value(await readSession(agentOf(ASG_LOPHN)));
    value(await listMessages(agentOf(ASG_LOPHN)));
    for (
      const other of [agentOf(ASG_CE), cred(`coding_agent:${id("cac", 1)}`)]
    ) {
      code(await readSession(other), "not_found");
      if (other.actor.startsWith("agent:")) {
        code(await listMessages(other), "not_found");
      }
      const list = value(
        await h.read({ resource: "sessions", method: "list" }, other, {}),
      ) as { sessions: unknown[] };
      assertEquals(list.sessions, []);
    }
    const mine = value(
      await h.read(
        { resource: "sessions", method: "list" },
        agentOf(ASG_LOPHN),
        {},
      ),
    ) as { sessions: unknown[] };
    assertEquals(mine.sessions.length, 1);
    // 없는 세션과 같은 답이다.
    code(
      await h.read({ resource: "sessions", method: "read" }, userCred, {
        session: id("ses", 30),
      }),
      "not_found",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R14: a request sent while paused is kept without a run and nothing runs it until a person chooses", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    value(
      await h.command(
        userCred,
        envelope("PauseAssignment", {
          assignment: ASG_LOPHN,
          reason: { kind: "user", detail: "잠시", runs: [], target: null },
        }, { revision: 1, state: "enabled" }),
      ),
    );
    const kept = output<Snapshot>(
      await receive(h, { message: id("msg", 1), session, mode: "request" }),
    );
    // 원문만 남고 담당 run·반영은 없다. 미실행으로 구분된다.
    assertEquals(kept.message["run"], null);
    assertEquals(kept.message["applied_at_call"], null);
    assertEquals(await count(h, "runs"), 0);
    assertEquals(
      (await eventsOf(h, "MessageReceived", id("msg", 1))).length,
      1,
    );
    // 현재 일 수정은 enabled에서만 접수한다. 멈춘 assignment에는 수정할 일이 없다.
    code(
      await receive(h, {
        message: id("msg", 2),
        session,
        mode: "correction",
        run: id("run", 1),
      }),
      "forbidden",
    );
    assertEquals(await count(h, "messages"), 1);
    // 재개만으로는 실행하지 않는다.
    value(
      await h.command(
        userCred,
        envelope("ResumeAssignment", { assignment: ASG_LOPHN }, {
          revision: 2,
          state: "paused",
        }),
      ),
    );
    assertEquals(await count(h, "runs"), 0);
    assertEquals((await messageRow(h, id("msg", 1)))!["run"], null);
    // 재개한 뒤 다른 요청을 보내도 보존한 요청은 실행되지 않는다.
    value(
      await receive(h, { message: id("msg", 2), session, mode: "request" }),
    );
    assertEquals(await count(h, "runs"), 1);
    assertEquals((await messageRow(h, id("msg", 1)))!["run"], null);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R14: choosing to run a kept request links one new run once, even when sent twice", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    value(
      await h.command(
        userCred,
        envelope("PauseAssignment", {
          assignment: ASG_LOPHN,
          reason: { kind: "user", detail: "잠시", runs: [], target: null },
        }, { revision: 1, state: "enabled" }),
      ),
    );
    value(
      await receive(h, { message: id("msg", 1), session, mode: "request" }),
    );
    const execute = async (
      message = id("msg", 1),
      revision = 2,
      extra = {},
    ) => {
      const row = (await sql(
        h,
        "select cast(state_seq as text) as s from messages where id = ?",
        [message],
      ))[0]!;
      return h.command(
        userCred,
        envelope("ExecuteStoredRequest", { message }, {
          assignment_revision: revision,
          assignment_state: "enabled",
          session_state: "open",
          session_state_seq: await sessionSeq(h, session),
          message_state_seq: String(row["s"]),
          actor: "user",
          mode: "request",
          run: null,
          applied_at_call: null,
          ...extra,
        }),
      );
    };
    // 멈춘 동안에는 실행을 고를 수 없다.
    code(await execute(), "forbidden");
    value(
      await h.command(
        userCred,
        envelope("ResumeAssignment", { assignment: ASG_LOPHN }, {
          revision: 2,
          state: "paused",
        }),
      ),
    );
    // 낡은 판 기준은 충돌이다.
    code(await execute(id("msg", 1), 1), "conflict");
    // 기계(자동 재개 경로)는 실행을 고르지 못한다.
    code(
      await h.command(
        machineCred,
        envelope("ExecuteStoredRequest", { message: id("msg", 1) }, {
          assignment_revision: 3,
          assignment_state: "enabled",
          session_state: "open",
          session_state_seq: await sessionSeq(h, session),
          message_state_seq: "1",
          actor: "user",
          mode: "request",
          run: null,
          applied_at_call: null,
        }),
      ),
      "forbidden",
    );
    assertEquals(await count(h, "runs"), 0);
    const executed = output<Snapshot>(await execute(id("msg", 1), 3));
    const run = String(executed.message["run"]);
    assertEquals(await count(h, "runs"), 1);
    const source =
      (await sql(h, "select source_message, session from runs where id = ?", [
        run,
      ]))[0]!;
    assertEquals(String(source["source_message"]), id("msg", 1));
    assertEquals(
      (await eventsOf(h, "MessageAssigned", id("msg", 1))).length,
      1,
    );
    assertEquals((await eventsOf(h, "RunAccepted", run)).length, 1);
    // 중복 전송에도 원문 하나와 담당 run 하나다.
    const again = output<Snapshot>(await execute(id("msg", 1), 3));
    assertEquals(again.message["run"], run);
    assertEquals(await count(h, "runs"), 1);
    assertEquals(await count(h, "messages"), 1);
    assertEquals(
      (await eventsOf(h, "MessageAssigned", id("msg", 1))).length,
      1,
    );
    // 이미 담당 run이 있는 요청은 이 경로로 새 run을 만들지 않고 그 담당을 돌려준다.
    value(
      await receive(h, { message: id("msg", 2), session, mode: "request" }),
    );
    const normal = await runOf(h, id("msg", 2));
    const second = output<Snapshot>(await execute(id("msg", 2), 3));
    assertEquals(second.message["run"], normal);
    assertEquals(await count(h, "runs"), 2);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R16: the work place of an App Engineer and an Operator is fixed to their scope and never changes by itself", async () => {
  const h = await open();
  try {
    await seed(h);
    value(
      await openSession(h, id("ses", 1), ASG_AE, "app_engineer", PLACES.app),
    );
    value(
      await openSession(h, id("ses", 2), ASG_OP, "operator", PLACES.project),
    );
    value(
      await openSession(
        h,
        id("ses", 3),
        ASG_CE,
        "context_engineer",
        PLACES.project,
      ),
    );
    const place = async (session: string) => {
      const read = value(
        await h.read({ resource: "sessions", method: "read" }, userCred, {
          session,
        }),
      ) as { session: { work_place: unknown; work_place_revision: number } };
      return read.session;
    };
    // 같은 세션을 다시 읽어도(탭 이동·재시작 뒤 조회) 자리는 같다.
    for (const _ of [1, 2]) {
      assertEquals((await place(id("ses", 1))).work_place, PLACES.app);
      assertEquals((await place(id("ses", 2))).work_place, PLACES.project);
      assertEquals((await place(id("ses", 3))).work_place, PLACES.project);
    }
    // 사람의 메시지나 run은 자리를 바꾸지 않는다.
    value(
      await receive(h, {
        message: id("msg", 1),
        session: id("ses", 3),
        mode: "request",
      }),
    );
    assertEquals((await place(id("ses", 3))).work_place_revision, 1);
    const change = async (session: string, role: string, target: Place) =>
      h.command(
        userCred,
        envelope("ChangeSessionWorkPlace", { session, work_place: target }, {
          state_seq: await sessionSeq(h, session),
          work_place_revision: 1,
          role,
        }),
      );
    // AE·Operator는 범위 밖 변경을 거절한다. 같은 범위도 변경이 아니다.
    code(
      await change(id("ses", 1), "lophn", { kind: "app", id: APP_OTHER }),
      "forbidden",
    );
    code(await change(id("ses", 1), "lophn", PLACES.global), "forbidden");
    code(
      await change(id("ses", 2), "context_engineer", {
        kind: "project",
        id: PROJECT_OTHER,
      }),
      "forbidden",
    );
    assertEquals((await place(id("ses", 1))).work_place, PLACES.app);
    assertEquals((await eventsOf(h, "SessionWorkPlaceChanged")).length, 0);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R17: lophn and Context Engineer change their work place only by an explicit valid choice, applied from the next call", async () => {
  const h = await open();
  try {
    await seed(h);
    await seedProvider(h);
    const session = id("ses", 1);
    value(
      await openSession(h, session, ASG_CE, "context_engineer", PLACES.global),
    );
    const run = await runningRun(h, session, id("msg", 1), ASG_CE);
    value(await startCall(h, id("mcl", 1), run, session));
    const runBefore =
      (await sql(h, "select basis, limits, state_seq from runs where id = ?", [
        run,
      ]))[0]!;
    const change = async (
      target: Place,
      revision = 1,
      role = "context_engineer",
      seq?: string,
      ctx = userCred,
    ) =>
      h.command(
        ctx,
        envelope("ChangeSessionWorkPlace", { session, work_place: target }, {
          state_seq: seq ?? await sessionSeq(h, session),
          work_place_revision: revision,
          role,
        }),
      );
    // 유효하지 않은 자리(없거나 보관된 대상)는 저장하지 않는다.
    code(await change({ kind: "project", id: id("prj", 30) }), "not_found");
    code(await change({ kind: "app", id: id("app", 30) }), "not_found");
    value(
      await h.command(
        machineCred,
        envelope("SeedTargetFixture", {
          type: "ProjectArchived",
          subject: PROJECT_OTHER,
        }),
      ),
    );
    code(await change({ kind: "project", id: PROJECT_OTHER }), "not_found");
    // 같은 자리는 변경이 아니다. 낡은 CAS와 사람이 아닌 actor는 거절이다.
    code(await change(PLACES.global), "invalid_input");
    code(await change(PLACES.project, 5), "conflict");
    code(await change(PLACES.project, 1, "lophn"), "conflict");
    code(
      await change(
        PLACES.project,
        1,
        "context_engineer",
        undefined,
        machineCred,
      ),
      "forbidden",
    );
    // 명시한 유효 자리는 저장한다. 변경은 판(revision)과 이전·이후를 event로 남긴다.
    const changed = output<
      { work_place: unknown; work_place_revision: number }
    >(
      await change(PLACES.project),
    );
    assertEquals(changed.work_place, PLACES.project);
    assertEquals(changed.work_place_revision, 2);
    const events = await eventsOf(h, "SessionWorkPlaceChanged", session);
    assertEquals(events.length, 1);
    const payload = JSON.parse(String(events[0]!["payload"]));
    assertEquals(payload.before.work_place, PLACES.global);
    assertEquals(payload.before.work_place_revision, 1);
    assertEquals(payload.after.work_place, PLACES.project);
    assertEquals(payload.after.work_place_revision, 2);
    // 진행 중 run의 시작 근거와 지난 call 기록은 바뀌지 않는다(다음 call부터 새 자리).
    const runAfter =
      (await sql(h, "select basis, limits, state_seq from runs where id = ?", [
        run,
      ]))[0]!;
    assertEquals(runAfter, runBefore);
    // app 자리로의 두 번째 변경은 새 판 기준으로 받는다.
    const app = output<{ work_place_revision: number }>(
      await change({ kind: "app", id: APP_OTHER }, 2),
    );
    assertEquals(app.work_place_revision, 3);
    // 닫힌 세션의 자리는 바꾸지 못한다.
    value(await finishRun(h, run, DONE));
    value(
      await h.command(
        userCred,
        envelope("CloseSession", { session, reason: "user_closed" }, {
          state_seq: await sessionSeq(h, session),
          state: "open",
        }),
      ),
    );
    code(await change(PLACES.global, 3), "conflict");
  } finally {
    await h.close();
  }
});

async function blobRefsOf(h: LedgerHarness, message: string) {
  return await sql(
    h,
    `select owner_kind, field, hash, size_bytes from blob_refs
     where owner_key = ?`,
    [message],
  );
}

Deno.test("lophn-agent/conversation#R2: a received body is one permanent blob reference in the same transaction as the message", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const message = id("msg", 1);
    const text = "한글 본문도 그대로 남긴다";
    value(await receive(h, { message, session, mode: "request", text }));
    // ledger에는 본문 값의 blob hash만 남고 같은 hash의 영구 참조 하나가 있다.
    const hash = bodyHashOf(text);
    assertEquals((await messageRow(h, message))?.["body"], hash);
    const refs = await blobRefsOf(h, message);
    assertEquals(refs.length, 1);
    assertEquals(
      [refs[0]!["owner_kind"], refs[0]!["field"], refs[0]!["hash"]],
      ["message", "body", hash],
    );
    const bytes = new TextEncoder().encode(
      JSON.stringify({ parts: [{ kind: "text", text }], schema_version: 1 }),
    );
    assertEquals(Number(refs[0]!["size_bytes"]), bytes.length);
    const [received] = await eventsOf(h, "MessageReceived", message);
    assertEquals(JSON.parse(String(received!["payload"]))["body"], hash);
    // 같은 값의 재전송은 참조를 더하지 않고 이전 결과다.
    value(await receive(h, { message, session, mode: "request", text }));
    assertEquals((await blobRefsOf(h, message)).length, 1);
    assertEquals(await count(h, "messages"), 1);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R2: without a live preparation nothing is stored and a retry takes the message once", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const message = id("msg", 1);
    value(
      await h.command(
        machineCred,
        envelope("SeedUnpreparedBody", { unprepared: true }),
      ),
    );
    code(
      await receive(h, { message, session, mode: "request", text: "hello" }),
      "invalid_input",
    );
    // 참조 등록이 막히면 message·event·run·참조 모두 되돌아간다.
    assertEquals(await count(h, "messages"), 0);
    assertEquals(await count(h, "runs"), 0);
    assertEquals((await blobRefsOf(h, message)).length, 0);
    assertEquals((await eventsOf(h, "MessageReceived", message)).length, 0);
    assertEquals((await eventsOf(h, "RunAccepted")).length, 0);
    value(
      await h.command(
        machineCred,
        envelope("SeedUnpreparedBody", { unprepared: false }),
      ),
    );
    value(
      await receive(h, { message, session, mode: "request", text: "hello" }),
    );
    assertEquals(await count(h, "messages"), 1);
    assertEquals(await count(h, "runs"), 1);
    assertEquals((await blobRefsOf(h, message)).length, 1);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R4: a recorded machine body is text only and a different body under the same id conflicts", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const run = await runningRun(h, session, id("msg", 1));
    const record = (message: string, content: unknown) =>
      h.command(
        machineCred,
        envelope("RecordMessage", {
          id: message,
          session,
          run,
          content,
          links: [],
        }),
      );
    value(await record(id("msg", 2), textContent("checked")));
    const refs = await blobRefsOf(h, id("msg", 2));
    assertEquals(refs.length, 1);
    assertEquals(refs[0]!["hash"], bodyHashOf("checked"));
    value(await record(id("msg", 2), textContent("checked")));
    code(await record(id("msg", 2), textContent("changed")), "conflict");
    // 시각 블록은 agent의 답에만 있다. machine이 보내면 저장하지 않는다.
    code(
      await record(id("msg", 3), {
        schema_version: 1,
        parts: [{ kind: "text", text: "x" }, {
          kind: "visual",
          block: {
            key: "t",
            schema_version: 1,
            kind: "table",
            title: "t",
            description: "d",
            sources: [],
            payload: { columns: [], rows: [] },
          },
        }],
      }),
      "invalid_input",
    );
    assertEquals((await blobRefsOf(h, id("msg", 3))).length, 0);
  } finally {
    await h.close();
  }
});
