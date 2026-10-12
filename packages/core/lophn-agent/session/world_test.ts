import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../../base/mod.ts";
import type {
  AuthenticatedContext,
  SqlRow,
} from "../../../protocol/platform/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../../apps/core/testing/ledger.ts";
import { envelope } from "../run-loop/testing/mod.ts";
import { BODY, cred, id, textContent } from "./testing/mod.ts";

// 세션·메시지 ledger 시험이 함께 쓰는 세계. 실제 등록 executor(harness)와 임시 ledger
// 파일을 쓰고 run-loop의 FinishRun이 제품 core와 같은 hasUnappliedSteering(messages 표)을
// 본다. 실제 provider를 부르지 않는다.

export const NOW = Date.UTC(2026, 0, 1);

export const userCred = cred("user");
export const machineCred = cred("machine");
export const ASG_LOPHN = id("asg", 1);
export const ASG_CE = id("asg", 2);
export const ASG_AE = id("asg", 3);
export const ASG_OP = id("asg", 4);
export const APP = id("app", 1);
export const APP_OTHER = id("app", 2);
export const PROJECT = id("prj", 1);
export const PROJECT_OTHER = id("prj", 2);
export const PVDR = id("pvd", 1);
const BASIS = "b".repeat(64);
const RESULT = "c".repeat(64);
const LIMITS = { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 };
export const DONE = { kind: "completed", reason: "answer_completed" };
export const FAILED = { kind: "failed", reason: "model_error" };

export const agentOf = (assignment: string) => cred(`agent:${assignment}`);

export function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

export function code(result: Result<unknown>, expected: string) {
  if (result.ok) {
    assert(false, "expected failure, got " + JSON.stringify(result.value));
  } else {
    assertEquals(result.error.code, expected);
  }
}

// command 결과의 본문. harness는 stored result 안에 출력을 담는다.
export type Snapshot = {
  message: Record<string, unknown>;
  created_seq: string;
  state_seq: string;
};
export function output<T>(result: Result<{ result: unknown }>): T {
  return value(result).result as T;
}

export async function open(): Promise<LedgerHarness> {
  const opened = await createLedgerHarness({
    registrationModules: [
      new URL(
        "../providers/registration_test.ts",
        import.meta.url,
      ),
      new URL("../usage/registration_test.ts", import.meta.url),
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

export async function sql(
  h: LedgerHarness,
  query: string,
  params: readonly (string | number | bigint)[] = [],
): Promise<SqlRow[]> {
  return value(await h.inspect(query, params));
}

export async function count(h: LedgerHarness, table: string, where = "1 = 1") {
  const row =
    (await sql(h, `select count(*) as n from ${table} where ${where}`))[
      0
    ]!;
  return Number(row["n"]);
}

export async function seed(h: LedgerHarness) {
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
      }),
    ),
  );
  value(
    await h.command(
      machineCred,
      envelope("SeedOperatorFixture", {
        id: ASG_OP,
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

// assignment를 멈추거나 되돌린다. 멈춤을 낳는 자리 보관 event는 이 leaf의 관심이 아니다.
export async function setAssignmentState(
  h: LedgerHarness,
  assignment: string,
  state: "enabled" | "paused",
) {
  return value(
    await h.command(
      machineCred,
      envelope("SeedAssignmentState", { assignment, state }),
    ),
  );
}

export async function assignmentOf(h: LedgerHarness, assignment: string) {
  const row = (await sql(
    h,
    "select revision, state from assignments where id = ?",
    [assignment],
  ))[0]!;
  return { revision: Number(row["revision"]), state: String(row["state"]) };
}

export async function sessionSeq(
  h: LedgerHarness,
  session: string,
): Promise<string> {
  const row = (await sql(
    h,
    "select cast(state_seq as text) as seq from sessions where id = ?",
    [session],
  ))[0]!;
  return String(row["seq"]);
}

export const PLACES = {
  project: { kind: "project", id: PROJECT },
  app: { kind: "app", id: APP },
} as const;

export type Place = { kind: string; id: string };

export async function openSession(
  h: LedgerHarness,
  session: string,
  assignment: string,
  place: Place,
  extra: { opening_context?: unknown; ctx?: AuthenticatedContext } = {},
) {
  const current = await assignmentOf(h, assignment);
  return h.command(
    extra.ctx ?? userCred,
    envelope("OpenSession", {
      id: session,
      assignment,
      work_place: place,
      opening_context: extra.opening_context ?? null,
    }, {
      assignment_revision: current.revision,
      assignment_state: "enabled",
    }),
  );
}

// assignment가 paused여도 compare는 enabled로 보낸다: 접수는 enabled 기준이고 paused는
// 그 기준을 어긴 입력으로 거절된다.
export async function receive(
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
      assignment_state: "enabled",
    }),
  );
}

export async function runStateSeq(
  h: LedgerHarness,
  run: string,
): Promise<string> {
  const read = value(
    await h.read({ resource: "runs", method: "read" }, userCred, { run }),
  ) as { run: { state_seq: string } };
  return read.run.state_seq;
}

export async function startRun(
  h: LedgerHarness,
  run: string,
  assignment: string,
) {
  const role = assignment === ASG_LOPHN
    ? "lophn"
    : assignment === ASG_CE
    ? "context_engineer"
    : assignment === ASG_OP
    ? "operator"
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

export async function finishRun(
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

export async function messageRow(h: LedgerHarness, message: string) {
  return (await sql(
    h,
    `select id, session, actor, body, run, mode, applied_at_call, links
     from messages where id = ?`,
    [message],
  ))[0];
}

export async function runOf(
  h: LedgerHarness,
  message: string,
): Promise<string> {
  const row = await messageRow(h, message);
  assert(row !== undefined && row["run"] !== null, "message has no run");
  return String(row["run"]);
}

export async function eventsOf(
  h: LedgerHarness,
  type: string,
  subject?: string,
) {
  return await sql(
    h,
    subject === undefined
      ? "select seq, subject, payload from events where type = ? order by seq"
      : "select seq, subject, payload from events where type = ? and subject = ? order by seq",
    subject === undefined ? [type] : [type, subject],
  );
}

// project 자리의 lophn session 하나.
export async function openLophn(h: LedgerHarness, session = id("ses", 1)) {
  value(await openSession(h, session, ASG_LOPHN, PLACES.project));
  return session;
}

// 사람 요청 하나로 시작한 run 하나를 만든다.
export async function runningRun(
  h: LedgerHarness,
  session: string,
  message: string,
  assignment = ASG_LOPHN,
  text?: string,
): Promise<string> {
  value(await receive(h, { message, session, mode: "request", text }));
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

export async function seedProvider(h: LedgerHarness) {
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
        credential: { kind: "none", preparation: null },
      }),
    ),
  );
}

// summary는 run 안의 압축 call이고 session_summary는 Compact가 쓰는 정리(organizing) 요약 call이다.
// 뒤의 것은 run과 agent 대신 session을 가리킨다. model을 주면 그 model로 부른다.
export function startCall(
  h: LedgerHarness,
  call: string,
  run: string | null,
  session: string,
  attempt = 1,
  use: {
    kind?: "judgment" | "summary" | "session_summary";
    model_name?: string;
  } = {},
) {
  const summary = use.kind === "summary" || use.kind === "session_summary";
  const bound = use.kind === "session_summary";
  const started = {
    id: call,
    run: bound ? null : run,
    session,
    model_use: summary ? "organizing" : "judgment",
    agent_hash: bound ? null : "ab".repeat(32),
    purpose: summary ? "conversation_compression" : "judgment",
    attempt_kind: "initial",
    attempt_order: attempt,
    retry_of: null,
    model: {
      provider: PVDR,
      name: use.model_name ?? "gpt",
      protocol: "openai-responses",
      credential_revision: null,
      options: {},
      option_values: { requested: {}, applied: {} },
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
    }, { state_seq: "4" }),
  );
}

// 시작한 call을 끝낸다. 시작 기록의 판 순번이 "4"이므로 그 기준으로 비교한다.
export function finishCall(
  h: LedgerHarness,
  call: string,
  outcome: { kind: string; code?: string | null } = { kind: "complete" },
  output: string | null = RESULT,
) {
  return h.command(
    machineCred,
    envelope("FinishModelCall", {
      call,
      output: outcome.kind === "complete" ? output : null,
      outcome: {
        kind: outcome.kind,
        code: outcome.code ?? null,
        retry_at: null,
        finish_reason: null,
        http_status: null,
        provider_code: null,
      },
      usage: {
        input: 100,
        output: 20,
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
      duration_ms: 10,
      first_output_ms: 5,
      state_seq: "5",
    }, { state_seq: "4" }),
  );
}

export function applyMessages(
  h: LedgerHarness,
  messages: string[],
  call: string,
) {
  return h.command(
    machineCred,
    envelope("ApplyMessages", { messages, call }, { applied_at_call: null }),
  );
}

// Fork·Compact 시험이 함께 쓰는 대화다. 메시지 ID는 아래 상수로 고정한다.
export const SOURCE_FIRST = id("msg", 1);
export const SOURCE_ANSWER = id("msg", 2);
export const SOURCE_SECOND = id("msg", 3);
export const SOURCE_LAST = id("msg", 4);

// 사람 요청 → 답 → 사람 요청 → 답, 두 run이 모두 끝난 session이다.
export async function finishedConversation(h: LedgerHarness): Promise<string> {
  const session = await openLophn(h);
  const first = await runningRun(h, session, SOURCE_FIRST, ASG_LOPHN, "first");
  value(
    await h.command(
      machineCred,
      envelope("RecordMessage", {
        id: SOURCE_ANSWER,
        session,
        run: first,
        content: textContent("answer one"),
        links: [],
      }),
    ),
  );
  value(await finishRun(h, first, DONE));
  const second = await runningRun(
    h,
    session,
    SOURCE_SECOND,
    ASG_LOPHN,
    "second",
  );
  value(
    await h.command(
      machineCred,
      envelope("RecordMessage", {
        id: SOURCE_LAST,
        session,
        run: second,
        content: textContent("answer two"),
        links: [],
      }),
    ),
  );
  value(await finishRun(h, second, DONE));
  return session;
}

export async function seqOf(
  h: LedgerHarness,
  message: string,
): Promise<string> {
  const rows = await sql(
    h,
    "select cast(created_seq as text) as seq from messages where id = ?",
    [message],
  );
  return String(rows[0]!["seq"]);
}
