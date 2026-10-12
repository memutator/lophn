// coding-agent#T42 제품 경로: 실제 core(임시 LOPHN_HOME)에 보고·문제·ticket을 심고, 실제 coding
// connection(그 앱 하나 범위)의 credential로 coding-agent worker의 수리 자료 조립을 부른다. 범위 밖
// 문제는 없는 문제와 같은 답이고, 글은 core 알려진 값 pipe(`redact_request`)를 지난다. 사람의 실제
// keychain·데이터 root는 열지 않는다(fake keychain, temp home).
import { assert, assertEquals, assertFalse } from "@std/assert";
import { err, ok, type Result } from "../../packages/base/mod.ts";
import { RepairContextSchema } from "../../packages/protocol/coding-agent/mod.ts";
import type { WorkerRequest } from "../../packages/protocol/platform/mod.ts";
import {
  createKnownSecretRegistry,
} from "../../packages/platform/redaction/mod.ts";
import {
  codingCredentialRef,
  createFakeKeychain,
  type FakeKeychain,
} from "../../packages/platform/secrets/mod.ts";
import {
  openWorld,
  type World,
} from "../../packages/apps/runtime/world_test.ts";
import { createRedactLink } from "../agent-runtime/redact-link.ts";
import {
  acceptRepairContext,
  REPAIR_CONTEXT_OPS,
  RepairContextRejection,
} from "../worker/coding-agent/repair-context.ts";
import { answerRedactRequest } from "./agent-runtime-redaction.ts";
import { codingAgentConnectionDefinitions } from "./coding-agent.ts";
import {
  problemsReportDefinitions,
  problemsTestDefinitions,
} from "./problems.ts";
import { ticketDefinitions } from "./tickets.ts";

const SECRET = "sk-live-ABCDEF0123456789SECRETVALUE";
const decoder = new TextDecoder();
const ABSENT_PROBLEM = "prb_01arz3ndektsv4rrffq69g5fb9";

type Reply = { status: number; body: Record<string, unknown> };

async function post(
  world: World,
  path: string,
  token: string,
  body: unknown,
): Promise<Reply> {
  const response = await fetch(
    `http://127.0.0.1:${world.harness.port}/v1/${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
  );
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

const envelope = (input: unknown, compare: unknown = {}) => ({
  input,
  idempotency_key: `k-${crypto.randomUUID()}`,
  compare,
  prepared: [],
});

const rpt = (n: number) => `rpt_01arz3ndektsv4rrffq69g5fa${n}`;
const snp = (n: number) => `snp_01arz3ndektsv4rrffq69g5fa${n}`;

// 같은 문제(exception key의 discriminator는 최초 rpt)에 접수되는 보고 하나.
function reportInput(
  machine: { principal: string },
  app: string,
  n: number,
  key: number,
  message: string,
  observedMs: number,
) {
  const at = new Date(observedMs).toISOString();
  const authentication = {
    principal: machine.principal,
    actor: "machine",
    scope: { operations: ["RecordReport"], targets: {} },
    conditions: {},
    credential_ref: `cred-${n}`,
  };
  return {
    report: {
      id: rpt(n),
      app,
      mode: "live",
      diagnostic_scope: null,
      release: "rel_01arz3ndektsv4rrffq69g5fav",
      release_missing_reason: null,
      bundle_hash: "a".repeat(64),
      source: "exception",
      code: "_exception",
      text: null,
      details: null,
      snapshot: snp(n),
      observed_at: at,
      principal: machine.principal,
      content_hash: String(n).repeat(64).slice(0, 64),
    },
    snapshot: {
      id: snp(n),
      captured_at: at,
      invocation: {
        id: "inv_01arz3ndektsv4rrffq69g5fav",
        binding: "sdk_context",
        record_missing_reason: null,
      },
      invocation_missing_reason: null,
      error: {
        name: "TypeError",
        message,
        message_missing_reason: null,
        frames: [{ path: `src/f${n}.ts`, function: null, line: 1, column: 1 }],
        source_missing_reason: null,
        stack: null,
        stack_missing_reason: { reason: "stack unavailable" },
        truncation_notes: [],
      },
      error_missing_reason: null,
      logs: null,
      logs_missing_reason: { reason: "log not collected" },
      screen: null,
      screen_missing_reason: { reason: "not collected" },
    },
    group_key: {
      kind: "exception",
      code: "_exception",
      discriminator: rpt(key),
    },
    existing_problem: null,
    blobs: [],
    origin: {
      context: {
        authentication,
        app,
        mode: "live",
        diagnostic_scope: null,
        release: "rel_01arz3ndektsv4rrffq69g5fav",
        release_missing_reason: null,
        bundle_hash: "a".repeat(64),
        binding: "sdk",
        origin: "process_observer",
      },
      report_id: rpt(n),
      content_hash: String(n).repeat(64).slice(0, 64),
    },
  };
}

async function record(
  world: World,
  token: string,
  input: ReturnType<typeof reportInput>,
): Promise<string> {
  const sent = await post(
    world,
    "problems/record-report",
    token,
    envelope(input, {
      active_release: "rel_01arz3ndektsv4rrffq69g5fav",
      problem_seq: null,
    }),
  );
  assertEquals(sent.status, 200, JSON.stringify(sent.body));
  return String(sent.body["problem"]);
}

Deno.test("coding-agent/repair-context#R1 R2 R18 R19 R20: 실제 coding connection으로 심은 문제·보고·ticket을 조립하고 범위 밖은 없는 대상과 같은 답이다", async () => {
  const keychain: FakeKeychain = createFakeKeychain();
  const world = await openWorld({
    approvals: true,
    extend: {
      teams: [
        { codingAgentConnectionDefinitions },
        { ticketDefinitions },
        { problemsTestDefinitions },
        { problemsReportDefinitions },
      ],
      teamModules: [
        new URL("./coding-agent.ts", import.meta.url).href,
        new URL("./tickets.ts", import.meta.url).href,
        new URL("./problems.ts", import.meta.url).href,
        new URL("./repair-context-ports_test.ts", import.meta.url).href,
      ],
      coding: { keychain, loaders: [] },
    },
  });
  try {
    await world.harness.codingCredentialsReady;
    const user = (await world.login("user", [
      "CreateCodingAgentConnection",
      "CreateTicket",
      "app.create",
    ])).token;
    const machine = await world.login("machine", ["RecordReport"]);
    const made = await post(
      world,
      "apps/create",
      user,
      envelope({ slug: "other", name: "Other", description: "other app" }),
    );
    assertEquals(made.status, 200, JSON.stringify(made.body));
    const otherApp = String(made.body["id"]);
    const t0 = Date.now() - 3_600_000;
    // 이 앱의 문제는 보고 둘(같은 문제), 다른 앱의 문제는 보고 하나다.
    const problem = await record(
      world,
      machine.token,
      reportInput(machine.context, world.app, 1, 1, `first ${SECRET}`, t0),
    );
    const again = await record(
      world,
      machine.token,
      reportInput(machine.context, world.app, 2, 1, "second", t0 + 60_000),
    );
    assertEquals(again, problem);
    const outside = await record(
      world,
      machine.token,
      reportInput(machine.context, otherApp, 3, 3, "outside", t0),
    );
    // repair ticket(문제 하나, 확인 필요 상태)을 사람이 만든다. title에 비밀을 넣는다.
    const created = await post(
      world,
      "tickets/create",
      user,
      envelope({
        app: world.app,
        kind: "repair",
        title: `Fix crash ${SECRET}`,
        what: "Stop the crash on save.",
        why: "Users lose data.",
        references: [],
        adoption_questions: [],
        conditions: [],
        inspect: ["src/f1.ts"],
        preserve: ["src/keep.ts"],
        problems: [problem],
        readiness: "needs_confirmation",
        needs: ["Confirm the acceptance checks."],
      }),
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));
    const ticket = String(created.body["ticket"]);
    // 이 앱 하나 범위의 실제 coding connection이다.
    const connected = await world.harness.codingCredentials!.connect(
      { label: "repair", scope: { kind: "app", app: world.app } },
      async (submission): Promise<Result<unknown>> => {
        const sent = await post(
          world,
          "coding_agent_connections/create",
          user,
          envelope(submission),
        );
        return sent.status === 200
          ? ok(sent.body)
          : err({ code: "conflict", message: `${sent.status}` });
      },
    );
    assert(connected.ok, connected.ok ? "" : connected.error.message);
    const token = decoder.decode(
      keychain.stored.get(codingCredentialRef(connected.value.connection)!)!,
    );
    // core 알려진 값 pipe: 알려진 비밀은 core 메모리에만 있고 worker는 지울 자리만 받는다.
    const known = createKnownSecretRegistry();
    known.register([SECRET]);
    const link = createRedactLink({
      send: (message) => {
        const answer = answerRedactRequest(message, {
          ready: true,
          match: (text) => known.match(text),
        });
        if (answer !== undefined) queueMicrotask(() => link.onParent(answer));
        return Promise.resolve();
      },
    });
    const ask = async (op: string, input: unknown, credential = token) =>
      await acceptRepairContext(
        {
          type: "worker_request",
          request_id: "r1",
          op,
          payload: { credential, input },
        } as WorkerRequest,
        {
          baseUrl: `http://127.0.0.1:${world.harness.port}`,
          redact: (text) => link.redact(text),
        },
      );
    const before = await post(world, "tickets/show", token, { ticket });

    // bundle: 문제·보고·ticket이 현재 정본에서 조립된다.
    const bundle = await ask(REPAIR_CONTEXT_OPS.bundle, {
      selector: { ticket },
    }) as { context: ReturnType<typeof RepairContextSchema.parse> };
    const context = RepairContextSchema.parse(bundle.context);
    assertEquals(context.app, world.app);
    assertEquals(context.ticket, ticket);
    assertEquals(context.problems, [problem]);
    const kinds = context.sections.map((section) => section.kind);
    for (
      const kind of [
        "target_symptom",
        "inspect",
        "acceptance_checks",
        "preserve",
        "failure_basis",
        "representative_occurrences",
        "more",
        "return_method",
      ]
    ) assert(kinds.includes(kind as never), `${kind} 절이 있다`);
    const reps = context.sections.find((section) =>
      section.kind === "representative_occurrences"
    )!;
    assert(reps.content.includes(rpt(1)), "첫 발생");
    assert(reps.content.includes(rpt(2)), "마지막 발생");
    // 없는 근거는 없다고 적고 채우지 않는다: 이 보고에는 log가 없고 release·invocation 기록은 심지 않았다.
    const logs = context.sections.find((section) => section.kind === "logs")!;
    assertEquals(logs.availability, "missing");
    const failure = context.sections.find((section) =>
      section.kind === "failure_basis"
    )!;
    assert(failure.reason!.includes("release"));
    assert(failure.reason!.includes("invocation"));
    // 알려진 비밀은 core pipe로 지워지고 어느 출력에도 없다. data fence 안에 있다.
    const summary = await ask(REPAIR_CONTEXT_OPS.summary, {
      selector: { ticket },
    });
    assertFalse(JSON.stringify([bundle, summary]).includes(SECRET));
    assert(JSON.stringify(summary).includes("limits"));
    assert(
      context.sections.find((section) =>
        section.kind === "target_symptom" && section.problem === problem
      )!.content.includes("<<<LOPHN-DATA"),
    );
    // problem selector는 ticket 준비 전 조사다. ticket이 null이다.
    const study = await ask(REPAIR_CONTEXT_OPS.bundle, {
      selector: { problem },
    }) as { context: { ticket: string | null } };
    assertEquals(study.context.ticket, null);

    // 범위 밖 문제는 없는 문제와 같은 답이다.
    const reject = async (target: string) => {
      try {
        await ask(REPAIR_CONTEXT_OPS.bundle, { selector: { problem: target } });
      } catch (thrown) {
        assert(thrown instanceof RepairContextRejection);
        return { code: thrown.code, message: thrown.message };
      }
      throw new Error("읽혀서는 안 된다");
    };
    const hidden = await reject(outside);
    assertEquals(hidden, await reject(ABSENT_PROBLEM));
    assertEquals(hidden.code, "not_found");

    // 읽기는 ticket·문제 상태를 바꾸지 않는다.
    const after = await post(world, "tickets/show", token, { ticket });
    assertEquals(after.body["ticket"], before.body["ticket"]);
    // 다른 두 번의 조립은 같은 사실이다(머리의 조립 시각만 다르다).
    const second = await ask(REPAIR_CONTEXT_OPS.bundle, {
      selector: { ticket },
    }) as { context: typeof context };
    assertEquals(
      second.context.sections.slice(1).map((section) => section.content),
      context.sections.slice(1).map((section) => section.content),
    );
  } finally {
    await world.close();
  }
});
