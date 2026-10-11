// lophn-agent/roles/app-engineer#R2: 실제 core(temp LOPHN_HOME)에서 App Engineer run credential이
// core가 발급하는 모양 그대로(targets {assignment, run}, conditions {assignment, run, process})일 때
// 담당 앱 문서는 읽고 다른 앱 문서는 없는 문서와 같은 답인지 본다. 모델 provider는 부르지 않고
// 사람 데이터 root(~/.lophn)는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { agentConditions, roleOperations } from "./agent-credentials.ts";
import { saveFromPaths } from "../../packages/coding-agent/connection/mod.ts";
import {
  DOCUMENT_OPERATIONS,
  openScopeWorld,
  type ScopeWorld,
} from "./testing/coding-agent-scope.ts";

const ASSIGNMENT = "asg_01arz3ndektsv4rrffq69g5fav";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const ABSENT_DOC = "doc_01arz3ndektsv4rrffq69g5fb9";
const TOKEN = "e".repeat(43);

type Saved = { document: string; version: string };

async function saveIn(
  world: ScopeWorld,
  slug: string,
  text: string,
  place: { kind: "app" | "project"; id: string } | undefined,
): Promise<Saved> {
  await Deno.writeTextFile(`${world.work}/${slug}.md`, text);
  const saved = await saveFromPaths(world.saveDeps("all"), {
    paths: [`${slug}.md`],
    ...(place === undefined ? {} : { place, slug }),
  });
  assert(saved.ok, saved.ok ? "" : JSON.stringify(saved.error));
  return saved.value.saved;
}

// 시험이 쓰는 읽기 operation이다. App Engineer의 역할 상한에 문서 읽기와 아직 정의가 없는 ticket 읽기를 더한다.
const ASSIGNED_READS = [
  ...new Set([
    ...DOCUMENT_OPERATIONS,
    ...roleOperations("app_engineer"),
    "ListTickets",
    "ShowTicket",
  ]),
];

async function accept(
  world: ScopeWorld,
  context: AuthenticatedContext,
  token: string,
) {
  const accepted = await world.core.acceptTestCredential?.(context, token);
  assert(accepted?.ok, JSON.stringify(accepted));
  const recorded = await world.core.record(context);
  assert(recorded.ok);
}

async function acceptAgent(
  world: ScopeWorld,
  app: string,
  options: {
    role?: string;
    source?: Parameters<typeof agentConditions>[0]["source"];
    operations?: readonly string[];
    token?: string;
  } = {},
) {
  // core가 발급하는 모양 그대로다: targets는 assignment·run뿐이고 앱은 conditions가 고정한다.
  const token = options.token ?? TOKEN;
  const context: AuthenticatedContext = {
    principal: `agent:${ASSIGNMENT}`,
    actor: `agent:${ASSIGNMENT}`,
    scope: {
      operations: [...options.operations ?? ASSIGNED_READS],
      targets: { assignment: ASSIGNMENT, run: RUN },
    },
    conditions: agentConditions({
      assignment: ASSIGNMENT,
      run: RUN,
      process: "agent-runtime",
      role: options.role ?? "app_engineer",
      scope: { kind: "app", id: app },
      ...(options.source === undefined ? {} : { source: options.source }),
    }),
    credential_ref: `cred-${token.slice(0, 4)}`,
  };
  await accept(world, context, token);
}

async function post(
  world: ScopeWorld,
  path: string,
  body: unknown,
  token: string = TOKEN,
) {
  const response = await fetch(`${world.baseUrl}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

Deno.test("lophn-agent/roles/app-engineer#R2: core가 발급하는 조건은 App Engineer에만 담당 앱을 고정한다", () => {
  const base = { assignment: ASSIGNMENT, run: RUN, process: "agent-runtime" };
  const scope = { kind: "app", id: "app_01arz3ndektsv4rrffq69g5fav" };
  assertEquals(agentConditions({ ...base, role: "app_engineer", scope }), {
    ...base,
    app: scope.id,
  });
  for (const role of ["lophn", "context_engineer", "operator"]) {
    assertEquals(agentConditions({ ...base, role, scope }), base);
  }
  // handoff의 고정 근거(문서, 판)는 App Engineer의 조건에만 실리고 중복은 한 번이다. 근거의 절·질문은
  // 싣지 않는다. 사람 요청으로 시작한 run에는 근거가 없다.
  const pinned = {
    kind: "handoff",
    references: [
      { document: "doc_a", version: "ver_a", section: "x", question: null },
      { document: "doc_a", version: "ver_a", section: null, question: null },
      { document: "doc_b", version: "ver_b", section: null, question: null },
    ],
  };
  assertEquals(
    agentConditions({ ...base, role: "app_engineer", scope, source: pinned }),
    {
      ...base,
      app: scope.id,
      evidence: [
        { document: "doc_a", version: "ver_a" },
        { document: "doc_b", version: "ver_b" },
      ],
    },
  );
  assertEquals(
    agentConditions({
      ...base,
      role: "app_engineer",
      scope,
      source: { kind: "message" },
    }),
    { ...base, app: scope.id },
  );
  assertEquals(
    agentConditions({ ...base, role: "lophn", scope, source: pinned }),
    base,
  );
});

Deno.test("lophn-agent/roles/app-engineer#R2: 실제 core에서 담당 앱 A 문서는 읽고 다른 앱·project·자리 없는 문서는 없는 문서와 같은 답이다", async () => {
  const world = await openScopeWorld(DOCUMENT_OPERATIONS);
  try {
    const a = await saveIn(world, "plan-a", "# A\n\n## 개요\n에이\n", {
      kind: "app",
      id: world.appA,
    });
    const b = await saveIn(world, "plan-b", "# B\n\n## 개요\n비\n", {
      kind: "app",
      id: world.appB,
    });
    const p = await saveIn(world, "plan-p", "# P\n\n## 개요\n피\n", {
      kind: "project",
      id: world.project,
    });
    const u = await saveIn(world, "plan-u", "# U\n\n## 개요\n무\n", undefined);
    await acceptAgent(world, world.appA);
    const reads = (doc: Saved) =>
      [
        ["documents/get", { document: doc.document }],
        ["documents/read", {
          reference: {
            document: doc.document,
            version: doc.version,
            section: null,
          },
          section: null,
          include_children: false,
          ranges: [],
        }],
        ["outline/document", {
          reference: {
            document: doc.document,
            version: doc.version,
            section: null,
          },
        }],
        ["documents/history", { document: doc.document }],
      ] as const;
    const absent: Saved = { document: ABSENT_DOC, version: a.version };
    // 담당 앱 문서는 읽힌다.
    for (const [path, body] of reads(a)) {
      const reply = await post(world, path, body);
      assertEquals(reply.status, 200, `${path} ${JSON.stringify(reply.body)}`);
    }
    // 다른 앱·project·자리 없는 문서는 없는 문서와 같은 상태와 본문이다.
    for (const hidden of [b, p, u]) {
      const absentReads = reads(absent);
      for (const [index, [path, body]] of reads(hidden).entries()) {
        const same = absentReads[index]!;
        const got = await post(world, path, body);
        const missing = await post(world, same[0], same[1]);
        assertEquals(got.status, 404, path);
        assertEquals(got.status, missing.status, path);
        assertEquals(got.body, missing.body, path);
      }
    }
    // 자리 목록도 담당 앱 문서만 보인다.
    const listed = await post(world, "documents/list", {});
    assertEquals(listed.status, 200);
    assertEquals(
      (listed.body as { documents: { document: { id: string } }[] })
        .documents.map((entry) => entry.document.id),
      [a.document],
    );
  } finally {
    await world.dispose();
  }
});

const ABSENT = {
  problem: "prb_01arz3ndektsv4rrffq69g5fb9",
  ticket: "tkt_01arz3ndektsv4rrffq69g5fb9",
  app: "app_01arz3ndektsv4rrffq69g5fb9",
};

const envelope = (input: unknown, compare: unknown = {}) => ({
  input,
  idempotency_key: `k-${crypto.randomUUID()}`,
  compare,
  prepared: [],
});

const rpt = (n: number) => `rpt_01arz3ndektsv4rrffq69g5fa${n}`;
const snp = (n: number) => `snp_01arz3ndektsv4rrffq69g5fa${n}`;

// 문제 하나를 만드는 보고 하나다(같은 앱의 다른 문제는 key를 달리한다).
function reportInput(app: string, n: number) {
  const at = new Date(Date.UTC(2024, 0, 1)).toISOString();
  const authentication = {
    principal: "collector-1",
    actor: "machine",
    scope: { operations: ["RecordReport"], targets: {} },
    conditions: {},
    credential_ref: `cred-report-${n}`,
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
      principal: "collector-1",
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
        message: `boom ${n}`,
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
    group_key: { kind: "exception", code: "_exception", discriminator: rpt(n) },
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

type Owned = { problem: string; ticket: string };

// 앱 하나에 문제·ticket을 심는다.
async function seed(
  world: ScopeWorld,
  app: string,
  n: number,
  user: string,
  machine: string,
): Promise<Owned> {
  const reported = await post(
    world,
    "problems/record-report",
    envelope(reportInput(app, n), {
      active_release: "rel_01arz3ndektsv4rrffq69g5fav",
      problem_seq: null,
    }),
    machine,
  );
  assertEquals(reported.status, 200, JSON.stringify(reported.body));
  const created = await post(
    world,
    "tickets/create",
    envelope({
      app,
      kind: "implementation",
      title: `앱 ${n} 일`,
      what: "상태 화면을 고친다",
      why: "상태가 틀리게 보인다",
      references: [],
      adoption_questions: [],
      conditions: [],
      inspect: ["src/leaf.ts"],
      preserve: [],
      problems: [],
      readiness: "needs_confirmation",
      needs: ["확인이 필요하다"],
    }),
    user,
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
  return {
    problem: String((reported.body as { problem: string }).problem),
    ticket: String((created.body as { ticket: string }).ticket),
  };
}

function idsOf(list: unknown, key: string): string[] {
  const rows = (list as Record<string, { id: string }[]>)[key] ?? [];
  return rows.map((row) => row.id).sort();
}

Deno.test("lophn-agent/roles/app-engineer#R2: 실제 core에서 담당 앱 A의 앱·문제·ticket은 읽고 B의 것은 모든 route에서 없는 대상과 같은 답이다", async () => {
  const world = await openScopeWorld(DOCUMENT_OPERATIONS);
  try {
    const user = "f".repeat(43);
    const machine = "g".repeat(43);
    await accept(world, {
      principal: "user",
      actor: "user",
      scope: {
        operations: ["CreateTicket"],
        targets: {},
      },
      conditions: {},
      credential_ref: "cred-user-seed",
    }, user);
    await accept(world, {
      principal: "collector-1",
      actor: "machine",
      scope: { operations: ["RecordReport"], targets: {} },
      conditions: {},
      credential_ref: "cred-machine-seed",
    }, machine);
    const a = await seed(world, world.appA, 1, user, machine);
    const b = await seed(world, world.appB, 2, user, machine);
    await acceptAgent(world, world.appA);

    // 담당 앱 A의 자료는 읽힌다.
    for (
      const [path, body] of [
        ["apps/get", { app: world.appA }],
        ["problems/get", { problem: a.problem }],
        ["tickets/show", { ticket: a.ticket }],
      ] as const
    ) {
      const reply = await post(world, path, body);
      assertEquals(reply.status, 200, `${path} ${JSON.stringify(reply.body)}`);
    }
    // B의 자료는 없는 대상과 같은 상태와 본문이다.
    for (
      const [path, hidden, absent] of [
        ["apps/get", { app: world.appB }, { app: ABSENT.app }],
        ["problems/get", { problem: b.problem }, { problem: ABSENT.problem }],
        ["tickets/show", { ticket: b.ticket }, { ticket: ABSENT.ticket }],
      ] as const
    ) {
      const got = await post(world, path, hidden);
      const missing = await post(world, path, absent);
      assertEquals(got.status, 404, `${path} ${JSON.stringify(got.body)}`);
      assertEquals(got.status, missing.status, path);
      assertEquals(got.body, missing.body, path);
    }
    // 목록에는 담당 앱 것만 보인다.
    const problems = await post(world, "problems/list", {});
    assertEquals(idsOf(problems.body, "problems"), [a.problem]);
    const tickets = await post(world, "tickets/list", {});
    assertEquals(idsOf(tickets.body, "tickets"), [a.ticket]);
    const ticketsB = await post(world, "tickets/list", { app: world.appB });
    assertEquals(idsOf(ticketsB.body, "tickets"), []);
    for (const path of ["releases/list", "invocations/list"]) {
      const listed = await post(world, path, { app: world.appB });
      assertEquals(listed.status, 200, path);
      assertEquals(
        Object.values(listed.body as Record<string, unknown>)
          .filter(Array.isArray).flat(),
        [],
        path,
      );
    }

    // 앱 조건이 없는 다른 역할은 지금 받는 읽기를 그대로 받는다.
    const lophn = "h".repeat(43);
    await acceptAgent(world, world.appA, {
      role: "lophn",
      token: lophn,
      operations: [
        ...new Set([...ASSIGNED_READS, ...roleOperations("lophn")]),
      ],
    });
    for (
      const [path, body] of [
        ["apps/get", { app: world.appB }],
        ["problems/get", { problem: b.problem }],
        ["tickets/show", { ticket: b.ticket }],
      ] as const
    ) {
      const reply = await post(world, path, body, lophn);
      assertEquals(reply.status, 200, `${path} ${JSON.stringify(reply.body)}`);
    }
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/roles/app-engineer#R2 lophn-agent/handoff#R6: handoff가 고정한 판은 그 run 동안 읽고 같은 문서의 최신 판·고정하지 않은 판·목록은 없는 문서와 같은 답이다", async () => {
  const world = await openScopeWorld(DOCUMENT_OPERATIONS);
  try {
    // project 문서(담당 앱 밖)에 판 둘, 다른 project 문서에 판 하나를 저장한다.
    const first = await saveIn(world, "plan", "# 기획\n\n## 개요\n처음\n", {
      kind: "project",
      id: world.project,
    });
    const second = await saveIn(world, "plan", "# 기획\n\n## 개요\n나중\n", {
      kind: "project",
      id: world.project,
    });
    assertEquals(first.document, second.document);
    assert(first.version !== second.version);
    const other = await saveIn(world, "other", "# 다른\n\n## 개요\n무\n", {
      kind: "project",
      id: world.project,
    });
    await acceptAgent(world, world.appA, {
      source: {
        kind: "handoff",
        references: [{ document: first.document, version: first.version }],
      },
    });
    const ref = (version: string, document = first.document) => ({
      reference: { document, version, section: null },
      section: null,
      include_children: false,
      ranges: [],
    });
    const outline = (version: string, document = first.document) => ({
      reference: { document, version, section: null },
    });
    // 고정한 판은 읽힌다.
    const pinned = await post(world, "documents/read", ref(first.version));
    assertEquals(pinned.status, 200, JSON.stringify(pinned.body));
    assertEquals((pinned.body as { version: string }).version, first.version);
    const pinnedOutline = await post(
      world,
      "outline/document",
      outline(first.version),
    );
    assertEquals(
      pinnedOutline.status,
      200,
      JSON.stringify(pinnedOutline.body),
    );
    // 같은 문서의 다른 판과 최신 판은 없는 문서와 같은 답이다.
    const absentRead = await post(
      world,
      "documents/read",
      ref(first.version, ABSENT_DOC),
    );
    const absentOutline = await post(
      world,
      "outline/document",
      outline(first.version, ABSENT_DOC),
    );
    for (
      const hidden of [
        ref(second.version),
        ref(other.version, other.document),
      ]
    ) {
      const got = await post(world, "documents/read", hidden);
      assertEquals(got.status, 404, JSON.stringify(got.body));
      assertEquals(got.body, absentRead.body);
    }
    const hiddenOutline = await post(
      world,
      "outline/document",
      outline(second.version),
    );
    assertEquals(hiddenOutline.status, 404);
    assertEquals(hiddenOutline.body, absentOutline.body);
    // 판 목록·문서 조회·자리 목록은 근거로 열리지 않는다.
    for (
      const [path, body] of [
        ["documents/get", { document: first.document }],
        ["documents/history", { document: first.document }],
      ] as const
    ) {
      const got = await post(world, path, body);
      const missing = await post(world, path, { document: ABSENT_DOC });
      assertEquals(got.status, 404, path);
      assertEquals(got.body, missing.body, path);
    }
    const listed = await post(world, "documents/list", {});
    assertEquals(listed.status, 200);
    assertEquals((listed.body as { documents: unknown[] }).documents, []);
    // handoff 근거가 없는 run은 같은 판도 열지 못한다.
    const plain = "i".repeat(43);
    await acceptAgent(world, world.appA, { token: plain });
    const unpinned = await post(
      world,
      "documents/read",
      ref(first.version),
      plain,
    );
    assertEquals(unpinned.status, 404);
    assertEquals(unpinned.body, absentRead.body);
  } finally {
    await world.dispose();
  }
});
