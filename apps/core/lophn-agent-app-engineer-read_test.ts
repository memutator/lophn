// lophn-agent/roles/app-engineer#R2: 실제 core(temp LOPHN_HOME)에서 App Engineer run credential이
// core가 발급하는 모양 그대로(targets {assignment, run}, conditions {assignment, run, process})일 때
// 담당 앱 문서는 읽고 다른 앱 문서는 없는 문서와 같은 답인지 본다. 모델 provider는 부르지 않고
// 사람 데이터 root(~/.lophn)는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import {
  bundleFinishCheckRoute,
  bundleSaveDraftRoute,
  bundleSubmitRoute,
  contextArchiveRoute,
  contextContractRoute,
  contextCreateRoute,
  contextDraftRoute,
  contextGetRoute,
  contextListRoute,
  contextOverviewRoute,
  contextSearchRoute,
  glossaryListRoute,
  glossarySetRoute,
} from "../../packages/contracts/documents/mod.ts";
import { AGENT_RUNTIME_PRINCIPAL } from "../../packages/contracts/lophn-agent/mod.ts";
import { routePath } from "../../packages/contracts/platform/mod.ts";
import { operationCeiling } from "../../packages/platform/identity/mod.ts";
import { agentRuntimePolicies } from "./agent-runtime.ts";
import { evalContent } from "../../packages/documents/contexts/api/testing.ts";
import { openIndexStore } from "../../packages/documents/contexts/index/mod.ts";
import { contextWorkerCredential } from "./contexts-api.ts";
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

// ---- context: 담당 앱을 app-data로 읽는 context의 overview·용어집 (roles/app-engineer#R2) ----

// post가 /v1/을 붙이므로 route 경로에서 판을 뗀다.
const pathOf = (route: { resource: string; method: string }) =>
  routePath(route).replace(/^\/v\d+\//, "");

// 앱 하나에 묶인 agent가 부를 수 있는 쓰기 operation이다(route의 actor 상한을 지나는 command).
const BOUND_WRITES = [bundleSaveDraftRoute.name, glossarySetRoute.name];

const SHA = "a".repeat(64);
const CTX_NOTES = "ctx_01arz3ndektsv4rrffq69g5fa1";
const CTX_LEDGER = "ctx_01arz3ndektsv4rrffq69g5fa2";
const CTX_PLAIN = "ctx_01arz3ndektsv4rrffq69g5fa3";
const CTX_ABSENT = "ctx_01arz3ndektsv4rrffq69g5fa9";
const TERM = "trm_01arz3ndektsv4rrffq69g5fa1";

const ROUTES = {
  get: pathOf(contextGetRoute),
  contract: pathOf(contextContractRoute),
  overview: pathOf(contextOverviewRoute),
  glossary: pathOf(glossaryListRoute),
  list: pathOf(contextListRoute),
  search: pathOf(contextSearchRoute),
  draft: pathOf(contextDraftRoute),
};
// 앱 하나에 묶인 agent의 credential이 가질 수 있는 context operation이다. R2가 말한 읽기와 그 밖의 읽기·쓰기를
// 모두 줘서 core가 operation이 아니라 target으로 거절하는지 본다.
const CONTEXT_OPERATIONS = [
  contextGetRoute.name,
  contextContractRoute.name,
  contextOverviewRoute.name,
  glossaryListRoute.name,
  contextListRoute.name,
  contextSearchRoute.name,
  contextDraftRoute.name,
  contextArchiveRoute.name,
  bundleSaveDraftRoute.name,
  glossarySetRoute.name,
];

// 앱 slug를 가리키는 app-data type 하나가 든 계약이다(앱 slug가 없으면 파일 type뿐이다).
function contentReading(slug: string | null): Record<string, unknown> {
  const content = evalContent() as {
    contract: { types: { name: string; source: { app?: string } }[] };
  };
  content.contract.types = content.contract.types.filter((type) =>
    slug === null ? type.name !== "Event" : true
  );
  for (const type of content.contract.types) {
    if (type.name === "Event" && slug !== null) type.source.app = slug;
  }
  return content as unknown as Record<string, unknown>;
}

const contextCommand = (input: unknown) => envelope(input);

async function acceptContextActors(world: ScopeWorld) {
  const tokens = {
    bound: "B".repeat(43),
    user: "U".repeat(43),
    admin: "A".repeat(43),
    engineer: "E".repeat(43),
    worker: "W".repeat(43),
  };
  const login = async (context: AuthenticatedContext, token: string) => {
    await accept(world, context, token);
  };
  await login({
    principal: "user-contexts",
    actor: "user",
    scope: {
      operations: [
        contextCreateRoute.name,
        glossarySetRoute.name,
        contextGetRoute.name,
      ],
      targets: {},
    },
    conditions: {},
    credential_ref: "cred-contexts-user",
  }, tokens.user);
  await login({
    principal: "admin",
    actor: "machine",
    scope: { operations: ["ListAssignments", "AcceptRun"], targets: {} },
    conditions: {},
    credential_ref: "cred-contexts-admin",
  }, tokens.admin);
  const listed = await post(world, "assignments/list", {}, tokens.admin);
  assertEquals(listed.status, 200, JSON.stringify(listed.body));
  const assignments = (listed.body as {
    assignments: { id: string; role: string; revision: number }[];
  }).assignments;
  const engineer = assignments.find((entry) =>
    entry.role === "context_engineer"
  );
  assert(engineer !== undefined);
  const run = "run_01arz3ndektsv4rrffq69g5fa1";
  const accepted = await post(
    world,
    "runs/accept",
    envelope({
      id: run,
      assignment: engineer.id,
      session: null,
      source: { kind: "message", message: "msg_01arz3ndektsv4rrffq69g5fa1" },
      continued_from: null,
      start_after: null,
    }, { assignment_revision: engineer.revision }),
    tokens.admin,
  );
  assertEquals(accepted.status, 200, JSON.stringify(accepted.body));
  // 쓰기 시험용: 접수된 run에 묶인 앱 하나(appA) 범위 agent다. 진짜 assignment가 있어야 agent command가
  // 끝난 run의 거절에 걸리지 않는다. 역할은 Context Engineer가 아닌 lophn assignment를 쓴다.
  const other = assignments.find((entry) => entry.role === "lophn");
  assert(other !== undefined);
  const boundRun = "run_01arz3ndektsv4rrffq69g5fa2";
  const acceptedOther = await post(
    world,
    "runs/accept",
    envelope({
      id: boundRun,
      assignment: other.id,
      session: null,
      source: { kind: "message", message: "msg_01arz3ndektsv4rrffq69g5fa2" },
      continued_from: null,
      start_after: null,
    }, { assignment_revision: other.revision }),
    tokens.admin,
  );
  assertEquals(acceptedOther.status, 200, JSON.stringify(acceptedOther.body));
  await login({
    principal: `agent:${other.id}`,
    actor: `agent:${other.id}`,
    scope: {
      operations: [...BOUND_WRITES],
      targets: { assignment: other.id, run: boundRun },
    },
    conditions: agentConditions({
      assignment: other.id,
      run: boundRun,
      process: "agent-runtime",
      role: "app_engineer",
      scope: { kind: "app", id: world.appA },
    }),
    credential_ref: "cred-contexts-bound",
  }, tokens.bound);
  await login({
    principal: `agent:${engineer.id}`,
    actor: `agent:${engineer.id}`,
    scope: {
      operations: ["bundle.save_draft", "bundle.submit", "context.get"],
      targets: { assignment: engineer.id, run },
    },
    conditions: { assignment: engineer.id, run },
    credential_ref: "cred-contexts-engineer",
  }, tokens.engineer);
  const worker = contextWorkerCredential();
  await login({
    principal: worker.principal,
    actor: worker.actor,
    scope: worker.scope,
    conditions: worker.conditions,
    credential_ref: "cred-contexts-worker",
  } as AuthenticatedContext, tokens.worker);
  return tokens;
}

type ContextTokens = Awaited<ReturnType<typeof acceptContextActors>>;

// context를 만들고 계약을 적용한다. 만들기는 사람이, 초안·제출은 Context Engineer가, 검사 통과는 worker가 한다.
async function applyContext(
  world: ScopeWorld,
  tokens: ContextTokens,
  context: string,
  title: string,
  slug: string | null,
  create = true,
) {
  if (create) {
    const created = await post(
      world,
      pathOf(contextCreateRoute),
      envelope({
        id: context,
        project: world.project,
        title,
        purpose: `${title} purpose`,
      }),
      tokens.user,
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));
  }
  const draft = await post(
    world,
    pathOf(bundleSaveDraftRoute),
    envelope({
      context,
      content: contentReading(slug),
    }),
    tokens.engineer,
  );
  assertEquals(draft.status, 200, JSON.stringify(draft.body));
  const submitted = await post(
    world,
    pathOf(bundleSubmitRoute),
    envelope({
      bundle: (draft.body as { id: string }).id,
    }),
    tokens.engineer,
  );
  assertEquals(submitted.status, 200, JSON.stringify(submitted.body));
  const body = submitted.body as { check: string; bundle_hash: string };
  const finished = await post(
    world,
    pathOf(bundleFinishCheckRoute),
    envelope({
      check: body.check,
      result: "passed",
      bundle_hash: body.bundle_hash,
      snapshot_hash: SHA,
      findings: [],
      violation_count: 0,
    }),
    tokens.worker,
  );
  assertEquals(finished.status, 200, JSON.stringify(finished.body));
  // context worker가 쓰는 derived index의 갱신 상태다(overview는 index가 있어야 읽힌다).
  await Deno.mkdir(`${world.core.dataRoot}/derived`, { recursive: true });
  const store = openIndexStore(
    `${world.core.dataRoot}/derived/contexts.sqlite`,
  );
  try {
    store.transaction((sql) => {
      sql.run(
        `INSERT OR REPLACE INTO index_state (context, bundle_hash, scanned_at, result)
         VALUES (?, ?, ?, 'complete')`,
        [context, body.bundle_hash, "2024-01-01T00:00:00.000Z"],
      );
    });
  } finally {
    store.close();
  }
}

Deno.test("lophn-agent/roles/app-engineer#R2 [ctx-I58b]: 실제 core에서 App Engineer는 담당 앱을 app-data로 읽는 context의 overview·용어집을 읽고 다른 context와 쓰기는 없는 대상과 같은 답이다", async () => {
  const world = await openScopeWorld(DOCUMENT_OPERATIONS);
  try {
    const tokens = await acceptContextActors(world);
    // 앱 slug는 world가 등록한 두 앱의 이름이다: appA = notes, appB = ledger.
    await applyContext(world, tokens, CTX_NOTES, "Notes data", "notes");
    await applyContext(world, tokens, CTX_LEDGER, "Ledger data", "ledger");
    await applyContext(world, tokens, CTX_PLAIN, "Files only", null);
    const set = await post(
      world,
      pathOf(glossarySetRoute),
      envelope({
        id: TERM,
        context: CTX_NOTES,
        term: "Note",
        meaning: "One written note",
      }),
      tokens.user,
    );
    assertEquals(set.status, 200, JSON.stringify(set.body));

    await acceptAgent(world, world.appA, {
      operations: [...new Set([...ASSIGNED_READS, ...CONTEXT_OPERATIONS])],
    });
    const reads = (context: string) =>
      [
        [ROUTES.get, { context }],
        [ROUTES.contract, { context }],
        [ROUTES.overview, { context }],
        [ROUTES.glossary, { context }],
      ] as const;
    // 담당 앱 notes를 읽는 context는 읽힌다.
    for (const [path, body] of reads(CTX_NOTES)) {
      const reply = await post(world, path, body);
      assertEquals(reply.status, 200, `${path} ${JSON.stringify(reply.body)}`);
    }
    const glossary = await post(world, ROUTES.glossary, { context: CTX_NOTES });
    assertEquals(
      (glossary.body as { entries: { term: string }[] }).entries.map((e) =>
        e.term
      ),
      ["Note"],
    );
    // 다른 앱을 읽는 context, 앱 data를 읽지 않는 context, 없는 context는 같은 상태와 본문이다.
    for (const hidden of [CTX_LEDGER, CTX_PLAIN]) {
      for (const [index, [path, body]] of reads(hidden).entries()) {
        const missing = reads(CTX_ABSENT)[index]!;
        const got = await post(world, path, body);
        const same = await post(world, missing[0], missing[1]);
        assertEquals(got.status, 404, `${path} ${JSON.stringify(got.body)}`);
        assertEquals(got.status, same.status, path);
        assertEquals(got.body, same.body, path);
      }
    }
    // 목록은 담당 앱을 읽는 context만 보인다.
    const listed = await post(world, ROUTES.list, { project: world.project });
    assertEquals(listed.status, 200, JSON.stringify(listed.body));
    assertEquals(
      (listed.body as { contexts: { id: string }[] }).contexts.map((c) => c.id),
      [CTX_NOTES],
    );
    // R2가 말하지 않은 읽기(검색·초안)와 모든 쓰기는 읽을 수 있는 context라도 없는 대상과 같은 답이다.
    const absentSearch = await post(world, ROUTES.search, {
      context: CTX_ABSENT,
      search: "none",
      inputs: {},
    });
    assertEquals(absentSearch.status, 404);
    for (
      const [path, body, token] of [
        [
          ROUTES.search,
          { context: CTX_NOTES, search: "none", inputs: {} },
          TOKEN,
        ],
        [ROUTES.draft, { context: CTX_NOTES }, TOKEN],
        [
          pathOf(bundleSaveDraftRoute),
          contextCommand({
            context: CTX_NOTES,
            content: contentReading("notes"),
          }),
          tokens.bound,
        ],
        [
          pathOf(glossarySetRoute),
          contextCommand({
            id: "trm_01arz3ndektsv4rrffq69g5fa2",
            context: CTX_NOTES,
            term: "Page",
            meaning: "One page",
          }),
          tokens.bound,
        ],
      ] as const
    ) {
      const got = await post(world, path, body, token);
      assertEquals(got.status, 404, `${path} ${JSON.stringify(got.body)}`);
      assertEquals(got.body, absentSearch.body, path);
    }
    // 사람만 부르는 command는 route의 actor 상한에서 이미 막힌다(agent는 403).
    const archived = await post(
      world,
      pathOf(contextArchiveRoute),
      contextCommand({ context: CTX_NOTES }),
    );
    assertEquals(archived.status, 403, JSON.stringify(archived.body));
    // 아무것도 쓰지 않았다: 용어집은 그대로다.
    const after = await post(world, ROUTES.glossary, { context: CTX_NOTES });
    assertEquals(
      (after.body as { entries: unknown[] }).entries.length,
      1,
    );

    // 앱에 묶이지 않은 lophn 역할 agent는 지금 받는 읽기를 그대로 받는다.
    const lophn = "j".repeat(43);
    await acceptAgent(world, world.appA, {
      role: "lophn",
      token: lophn,
      operations: [...new Set([...ASSIGNED_READS, ...CONTEXT_OPERATIONS])],
    });
    for (const [path, body] of reads(CTX_LEDGER)) {
      const reply = await post(world, path, body, lophn);
      assertEquals(reply.status, 200, `${path} ${JSON.stringify(reply.body)}`);
    }
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/roles/app-engineer#R2 [ctx-I58b]: 판을 새로 적용하면 읽는 앱이 바뀌어 App Engineer가 읽는 context도 바뀐다", async () => {
  const world = await openScopeWorld(DOCUMENT_OPERATIONS);
  try {
    const tokens = await acceptContextActors(world);
    await applyContext(world, tokens, CTX_NOTES, "Notes data", "notes");
    const appB = "k".repeat(43);
    await acceptAgent(world, world.appA, {
      operations: [...new Set([...ASSIGNED_READS, ...CONTEXT_OPERATIONS])],
    });
    await acceptAgent(world, world.appB, {
      token: appB,
      operations: [...new Set([...ASSIGNED_READS, ...CONTEXT_OPERATIONS])],
    });
    const overview = (token: string) =>
      post(world, ROUTES.overview, { context: CTX_NOTES }, token);
    assertEquals((await overview(TOKEN)).status, 200);
    assertEquals((await overview(appB)).status, 404);

    // 같은 context의 다음 판이 다른 앱을 읽는다.
    await applyContext(world, tokens, CTX_NOTES, "Notes data", "ledger", false);
    assertEquals((await overview(TOKEN)).status, 404);
    assertEquals((await overview(appB)).status, 200);
  } finally {
    await world.dispose();
  }
});

// agent runtime의 machine 자격이다. core가 hello에 싣는 모양 그대로(principal `machine:agent-runtime`,
// scope는 RUNTIME_MACHINE_OPERATIONS)이고 시험은 context 읽기 operation만 올린다.
function runtimeCredential(principal: string): AuthenticatedContext {
  return {
    principal,
    actor: "machine",
    scope: {
      operations: [...new Set([...CONTEXT_OPERATIONS, "ListAssignments"])],
      targets: { task: "lophn-agent" },
    },
    conditions: { task: "lophn-agent", process: "lophn-agent/runtime" },
    credential_ref: `cred-${principal}`,
  } as AuthenticatedContext;
}

Deno.test("documents/contexts#R19 lophn-agent/harness/tools#R21 [ctx-I56b]: 실제 core에서 runtime machine 자격은 context.list·get·contract만 읽고 판을 지정해 읽으며 다른 읽기와 다른 machine 자격은 거절된다", async () => {
  const world = await openScopeWorld(DOCUMENT_OPERATIONS);
  try {
    const tokens = await acceptContextActors(world);
    await applyContext(world, tokens, CTX_NOTES, "Notes data", "notes");
    const runtime = "r".repeat(43);
    const hosts = "h".repeat(43);
    await accept(world, runtimeCredential(AGENT_RUNTIME_PRINCIPAL), runtime);
    await accept(
      world,
      runtimeCredential("machine:agent-runtime-hosts"),
      hosts,
    );

    const first = await post(
      world,
      ROUTES.contract,
      { context: CTX_NOTES },
      runtime,
    );
    assertEquals(first.status, 200, JSON.stringify(first.body));
    const pinned = first.body as { bundle: string; bundle_hash: string };

    // 같은 context의 다음 판이 적용돼 지금 적용된 판이 바뀐다.
    await applyContext(world, tokens, CTX_NOTES, "Notes data", "ledger", false);
    const current = await post(
      world,
      ROUTES.contract,
      { context: CTX_NOTES },
      runtime,
    );
    assertEquals(current.status, 200);
    assertEquals(
      (current.body as { bundle: string }).bundle !== pinned.bundle,
      true,
    );
    // 판을 지정하면 지금 적용된 판이 아니라 그 판(superseded)의 id·hash·content다.
    const old = await post(
      world,
      ROUTES.contract,
      { context: CTX_NOTES, bundle: pinned.bundle },
      runtime,
    );
    assertEquals(old.status, 200, JSON.stringify(old.body));
    const oldBody = old.body as {
      bundle: string;
      bundle_hash: string;
      content: { contract: { types: { source: { app?: string } }[] } };
    };
    assertEquals(oldBody.bundle, pinned.bundle);
    assertEquals(oldBody.bundle_hash, pinned.bundle_hash);
    assertEquals(oldBody.content.contract.types[0]!.source.app, "notes");

    // 없는 판과 다른 context의 판은 없는 것과 같다.
    const missing = await post(
      world,
      ROUTES.contract,
      { context: CTX_NOTES, bundle: "cbn_01arz3ndektsv4rrffq69g5fa9" },
      runtime,
    );
    assertEquals(missing.status, 404, JSON.stringify(missing.body));

    // list는 project와 app으로 읽는다. app은 그 앱을 읽는 active context다.
    const byProject = await post(
      world,
      ROUTES.list,
      { project: world.project },
      runtime,
    );
    assertEquals(byProject.status, 200, JSON.stringify(byProject.body));
    const idsOf = (reply: { body: unknown }) =>
      (reply.body as { contexts: { id: string }[] }).contexts.map((c) => c.id);
    assertEquals(idsOf(byProject), [CTX_NOTES]);
    // 지금 판은 ledger를 읽는다.
    assertEquals(
      idsOf(await post(world, ROUTES.list, { app: world.appA }, runtime)),
      [],
    );
    assertEquals(
      idsOf(await post(world, ROUTES.list, { app: world.appB }, runtime)),
      [CTX_NOTES],
    );
    assertEquals(
      (await post(world, ROUTES.list, {
        app: world.appB,
        project: world.project,
      }, runtime)).status,
      400,
    );
    const get = await post(world, ROUTES.get, { context: CTX_NOTES }, runtime);
    assertEquals(get.status, 200, JSON.stringify(get.body));

    // 다른 읽기는 이 자격에 열려 있지 않다(route의 actor 상한 또는 handler가 막는다).
    for (
      const [path, body] of [
        [ROUTES.overview, { context: CTX_NOTES }],
        [ROUTES.glossary, { context: CTX_NOTES }],
        [ROUTES.draft, { context: CTX_NOTES }],
        [ROUTES.search, { context: CTX_NOTES, search: "none", inputs: {} }],
      ] as const
    ) {
      const reply = await post(world, path, body, runtime);
      assertEquals(reply.status, 403, `${path} ${JSON.stringify(reply.body)}`);
    }
    // 다른 machine 자격은 같은 operation을 가져도 list·get·contract를 읽지 못한다.
    for (
      const [path, body] of [
        [ROUTES.list, { project: world.project }],
        [ROUTES.get, { context: CTX_NOTES }],
        [ROUTES.contract, { context: CTX_NOTES }],
      ] as const
    ) {
      const reply = await post(world, path, body, hosts);
      assertEquals(reply.status, 403, `${path} ${JSON.stringify(reply.body)}`);
    }
  } finally {
    await world.dispose();
  }
});

Deno.test("documents/contexts#R19 lophn-agent/harness/tools#R21 [ctx-I56b]: runtime machine의 발급 상한에 context.list·get·contract가 들고 overview·search는 없다", () => {
  const ceiling = operationCeiling(
    "machine",
    agentRuntimePolicies(
      [
        contextListRoute,
        contextGetRoute,
        contextContractRoute,
        contextOverviewRoute,
        contextSearchRoute,
      ],
    ),
  );
  for (
    const route of [contextListRoute, contextGetRoute, contextContractRoute]
  ) assert(ceiling.includes(route.name), route.name);
  for (const route of [contextOverviewRoute, contextSearchRoute]) {
    assert(!ceiling.includes(route.name), route.name);
  }
});
