import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../../base/mod.ts";
import type {
  AuthenticatedContext,
  SqlRow,
} from "../../../contracts/platform/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../../apps/core/testing/ledger.ts";
import {
  envelope,
  presetDefinitionJson,
} from "../../harness/run-loop/testing/mod.ts";
import { BODY, cred, hashOf, id, textContent } from "./mod.ts";

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
        "../../harness/provider/registration_test.ts",
        import.meta.url,
      ),
      new URL("../../harness/usage/registration_test.ts", import.meta.url),
      new URL("../registration_test.ts", import.meta.url),
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
      }),
    ),
  );
}

export function startCall(
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
