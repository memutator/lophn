// documents/contexts#R25 [ctx-I58h]: 사람이 위반을 Context Engineer에게 넘기면 그 context의 project를 작업
// 자리로 하는 Context Engineer 세션에 근거가 붙은 사람 요청이 놓이고 담당 Run 하나가 접수된다. 임시 data
// root에서 core를 띄우고(사람 데이터 root는 열지 않는다) 위반은 context worker의 좁은 자격으로 기록한다
// (실제 worker는 띄우지 않는다: CoreOptions.contextWorker false).
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { openIndexStore } from "../../packages/documents/contexts/index/mod.ts";
import { minimalContent } from "../../packages/documents/contexts/api/testing.ts";
import { type Core, startCore } from "./core.ts";
import { contextWorkerCredential } from "./contexts-api.ts";
import {
  REQUEST_TEXT_MAX_BYTES,
  violationRequestText,
} from "./contexts-handoff.ts";
import { createLedgerRegistration } from "./documents.ts";
import {
  createLedgerRegistration as createLophnAgentRegistration,
  lophnAgentDefinitions,
} from "./lophn-agent.ts";
import { closeUnlessKept } from "./testing/close-on-throw.ts";

const PROJECT = "prj_01kq12a1pha000000000000000";
const CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fav";
const SHA = "a".repeat(64);

type Json = Record<string, unknown>;
type Who = "user" | "engineer" | "worker" | "admin";

const TOKENS: Record<Who, string> = {
  user: "u".repeat(43),
  engineer: "e".repeat(43),
  worker: "w".repeat(43),
  admin: "m".repeat(43),
};
const RUN_ENGINEER = "run_01arz3ndektsv4rrffq69g5fav";
const MESSAGE_ENGINEER = "msg_01arz3ndektsv4rrffq69g5fav";

const USER_OPERATIONS = [
  "ListAssignments",
  "PauseAssignment",
  "ReadRun",
  "ListRuns",
  "ReadSession",
  "ListSessions",
  "ReadMessageBody",
  "project.create",
  "context.create",
  "context.hand_off_violations",
  "context.violations",
];
const ENGINEER_OPERATIONS = [
  "bundle.save_draft",
  "bundle.submit",
  "context.get",
  "context.draft",
];

function contextOf(
  who: Who,
  actor: string,
  operations: readonly string[],
  principal: string,
  run?: { assignment: string; run: string },
): AuthenticatedContext {
  return {
    principal,
    actor,
    credential_ref: `cred_handoff_${who}`,
    scope: { operations: [...operations], targets: run ?? {} },
    conditions: run ?? {},
  } as AuthenticatedContext;
}

type Engineer = { id: string; revision: number };

async function open(
  home: string,
  folder: string,
): Promise<{ core: Core; engineer: Engineer }> {
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [
      { createLedgerRegistration },
      { lophnAgentDefinitions },
      { createLedgerRegistration: createLophnAgentRegistration },
    ],
    teamModules: [
      new URL("./documents.ts", import.meta.url).href,
      new URL("./lophn-agent.ts", import.meta.url).href,
    ],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(31),
    testCredentials: true,
    contextWorker: false,
  });
  assert(started.ok, started.ok ? "" : JSON.stringify(started.error));
  await using guard = closeUnlessKept(async () => {
    await started.value.shutdown();
  });
  const core = started.value;
  assert(core.acceptTestCredential);
  const login = async (context: AuthenticatedContext, who: Who) => {
    const accepted = await core.acceptTestCredential!(context, TOKENS[who]);
    assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
    const recorded = await core.record(context);
    assert(recorded.ok, recorded.ok ? "" : recorded.error.message);
  };
  await login(
    contextOf("user", "user", USER_OPERATIONS, "user-handoff"),
    "user",
  );
  await login(
    contextOf("admin", "machine", ["ListAssignments", "AcceptRun"], "admin"),
    "admin",
  );
  const assignments = await post(core, "admin", "assignments/list", {});
  assertEquals(assignments.status, 200, JSON.stringify(assignments.body));
  const listed = assignments.body["assignments"] as {
    id: string;
    role: string;
    revision: number;
  }[];
  const engineer = listed.find((entry) => entry.role === "context_engineer");
  assert(engineer, "the product core prepares the builtin assignments");
  // Context Engineer의 agent 자격은 접수된 Run에 묶인다(platform/ledger#R11).
  const accepted = await post(
    core,
    "admin",
    "runs/accept",
    command(
      {
        id: RUN_ENGINEER,
        assignment: engineer.id,
        session: null,
        source: { kind: "message", message: MESSAGE_ENGINEER },
        continued_from: null,
        start_after: null,
      },
      "accept-engineer",
      { assignment_revision: engineer.revision },
    ),
  );
  assertEquals(accepted.status, 200, JSON.stringify(accepted.body));
  await login(
    contextOf(
      "engineer",
      `agent:${engineer.id}`,
      ENGINEER_OPERATIONS,
      `agent:${engineer.id}`,
      { assignment: engineer.id, run: RUN_ENGINEER },
    ),
    "engineer",
  );
  const worker = contextWorkerCredential();
  await login(
    contextOf(
      "worker",
      worker.actor,
      worker.scope.operations,
      worker.principal,
    ),
    "worker",
  );
  const created = await post(core, "user", "projects/create", {
    input: {
      id: PROJECT,
      name: "alpha",
      title: "Alpha",
      purpose: "",
      folders: [{ path: folder, description: "a" }],
      tracking: { enabled: false, patterns: [], use_gitignore: false },
    },
    idempotency_key: "create-project",
    compare: {},
    prepared: [],
  });
  assertEquals(created.status, 200, JSON.stringify(created.body));
  guard.keep();
  return { core, engineer };
}

async function post(
  core: Core,
  who: Who,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Json }> {
  const response = await fetch(`http://127.0.0.1:${core.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKENS[who]}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: Json = {};
  try {
    parsed = JSON.parse(text) as Json;
  } catch { /* 본문이 JSON이 아니면 빈 객체다 */ }
  return { status: response.status, body: parsed };
}

function command(input: unknown, key: string, compare: unknown = {}) {
  return { input, idempotency_key: key, compare, prepared: [] };
}

async function withCore(
  run: (core: Core, engineer: Engineer) => Promise<void>,
): Promise<void> {
  const home = await Deno.makeTempDir({ prefix: "lophn-contexts-handoff-" });
  const folder = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-contexts-handoff-folder-" }),
  );
  const { core, engineer } = await open(home, folder);
  try {
    await run(core, engineer);
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
    await Deno.remove(folder, { recursive: true });
  }
}

// context를 만들고 최소 계약을 적용한 뒤, 위반 둘을 derived index에 채우고 worker 자격으로 위반 수를
// 기록한다. 위반을 읽는 index는 context worker가 쓰는 파일이다(여기서는 같은 표를 직접 채운다).
async function seedViolations(core: Core): Promise<void> {
  const created = await post(
    core,
    "user",
    "contexts/create",
    command({
      id: CONTEXT,
      project: PROJECT,
      title: "Evaluation",
      purpose: "Experiments and their findings",
    }, "create-context"),
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
  const draft = await post(
    core,
    "engineer",
    "contexts/save_draft",
    command({ context: CONTEXT, content: minimalContent() }, "draft"),
  );
  assertEquals(draft.status, 200, JSON.stringify(draft.body));
  const submitted = await post(
    core,
    "engineer",
    "contexts/submit_bundle",
    command({ bundle: draft.body["id"] }, "submit"),
  );
  assertEquals(submitted.status, 200, JSON.stringify(submitted.body));
  const hash = String(submitted.body["bundle_hash"]);
  const finished = await post(
    core,
    "worker",
    "contexts/record_check",
    command({
      check: submitted.body["check"],
      result: "passed",
      bundle_hash: hash,
      snapshot_hash: SHA,
      findings: [],
      violation_count: 0,
    }, "finish"),
  );
  assertEquals(finished.status, 200, JSON.stringify(finished.body));
  await Deno.mkdir(`${core.dataRoot}/derived`, { recursive: true });
  const store = openIndexStore(`${core.dataRoot}/derived/contexts.sqlite`);
  try {
    store.transaction((sql) => {
      sql.run(
        `INSERT INTO index_state (context, bundle_hash, scanned_at, result)
         VALUES (?, ?, ?, 'complete')`,
        [CONTEXT, hash, "2024-01-01T00:00:00.000Z"],
      );
      for (
        const [ord, path] of [[0, "eval/experiments/exp-002-b.md"], [
          1,
          "eval/experiments/exp-003-c.md",
        ]] as const
      ) {
        sql.run(
          `INSERT INTO index_violations
             (context, ord, kind, rule, type, path, section, target)
           VALUES (?, ?, 'rule', 'Experiment.status-required', 'Experiment',
                   ?, NULL, 'status')`,
          [CONTEXT, ord, path],
        );
      }
    });
  } finally {
    store.close();
  }
  const recorded = await post(
    core,
    "worker",
    "contexts/record_violations",
    command({ context: CONTEXT, count: 2, bundle_hash: hash }, "record"),
  );
  assertEquals(recorded.status, 200, JSON.stringify(recorded.body));
}

async function violationsOf(core: Core): Promise<Json[]> {
  const read = await post(core, "user", "contexts/violations", {
    context: CONTEXT,
  });
  assertEquals(read.status, 200, JSON.stringify(read.body));
  return read.body["violations"] as Json[];
}

const keyOf = (path: string) => ({
  kind: "rule",
  rule: "Experiment.status-required",
  path,
  section: null,
});

Deno.test("documents/contexts#R25 [ctx-I58h]: handing violations off starts a Context Engineer run in a project session with the evidence as the request", async () => {
  await withCore(async (core, engineer) => {
    await seedViolations(core);
    const before = await violationsOf(core);
    assertEquals(before.map((item) => item["handed_off"]), [false, false]);

    const handed = await post(
      core,
      "user",
      "contexts/hand_off_violations",
      command(
        {
          context: CONTEXT,
          violations: [keyOf("eval/experiments/exp-002-b.md")],
        },
        "hand-off",
      ),
    );
    assertEquals(handed.status, 200, JSON.stringify(handed.body));
    assertEquals(handed.body["context"], CONTEXT);
    assertEquals(handed.body["violation_count"], 1);
    const run = String(handed.body["run"]);

    // 같은 요청의 재전송은 Run을 더 만들지 않는다.
    const again = await post(
      core,
      "user",
      "contexts/hand_off_violations",
      command(
        {
          context: CONTEXT,
          violations: [keyOf("eval/experiments/exp-002-b.md")],
        },
        "hand-off",
      ),
    );
    assertEquals(again.status, 200, JSON.stringify(again.body));
    assertEquals(again.body["run"], run);

    // 그 Run은 Context Engineer의 것이고 사람 요청 message에서 시작한다.
    const read = await post(core, "user", "runs/read", { run });
    assertEquals(read.status, 200, JSON.stringify(read.body));
    const record = read.body["run"] as Json;
    assertEquals(record["assignment"], engineer.id);
    assertEquals(record["state"], "accepted");
    const source = record["source"] as Json;
    assertEquals(source["kind"], "message");

    // 세션의 작업 자리는 그 context의 project다.
    const session = await post(core, "user", "sessions/read", {
      session: record["session"],
    });
    assertEquals(session.status, 200, JSON.stringify(session.body));
    const opened = session.body["session"] as Json;
    assertEquals(opened["assignment"], engineer.id);
    assertEquals(opened["work_place"], { kind: "project", id: PROJECT });

    // 요청 글에 넘긴 위반의 파일 경로와 규칙이 있고, 넘기지 않은 위반은 없다.
    const body = await post(core, "user", "messages/body", {
      message: source["message"],
    });
    assertEquals(body.status, 200, JSON.stringify(body.body));
    const content = body.body["content"] as {
      parts: { kind: string; text: string }[];
    };
    const text = content.parts.map((part) => part.text).join("\n");
    assert(text.includes(CONTEXT), text);
    assert(text.includes("eval/experiments/exp-002-b.md"), text);
    assert(text.includes("Experiment.status-required"), text);
    assert(!text.includes("exp-003-c"), text);

    // 넘긴 위반만 handed_off가 된다.
    const after = await violationsOf(core);
    assertEquals(
      after.map((item) => [item["path"], item["handed_off"]]),
      [
        ["eval/experiments/exp-002-b.md", true],
        ["eval/experiments/exp-003-c.md", false],
      ],
    );
  });
});

Deno.test("documents/contexts#R25 [ctx-I58h]: without keys it hands off every violation in one run", async () => {
  await withCore(async (core) => {
    await seedViolations(core);
    const handed = await post(
      core,
      "user",
      "contexts/hand_off_violations",
      command({ context: CONTEXT }, "hand-off-all"),
    );
    assertEquals(handed.status, 200, JSON.stringify(handed.body));
    assertEquals(handed.body["violation_count"], 2);
    const runs = await post(core, "user", "runs/list", {});
    assertEquals(runs.status, 200, JSON.stringify(runs.body));
    const ids = (runs.body["runs"] as { id: string }[]).map((run) => run.id);
    assertEquals(ids.filter((id) => id === handed.body["run"]).length, 1);
    assertEquals(
      (await violationsOf(core)).map((item) => item["handed_off"]),
      [true, true],
    );
  });
});

Deno.test("documents/contexts#R25 [ctx-I58h]: with no enabled Context Engineer the hand-off is unavailable and leaves nothing", async () => {
  await withCore(async (core, engineer) => {
    await seedViolations(core);
    const paused = await post(
      core,
      "user",
      "assignments/pause",
      command(
        {
          assignment: engineer.id,
          reason: { kind: "user", detail: "pause", runs: [], target: null },
        },
        "pause-engineer",
        { revision: engineer.revision, state: "enabled" },
      ),
    );
    assertEquals(paused.status, 200, JSON.stringify(paused.body));
    const runsBefore = await post(core, "user", "runs/list", {});
    const sessionsBefore = await post(core, "user", "sessions/list", {});

    const handed = await post(
      core,
      "user",
      "contexts/hand_off_violations",
      command({ context: CONTEXT }, "hand-off-paused"),
    );
    assertEquals(handed.status, 503, JSON.stringify(handed.body));
    assertEquals(
      (await violationsOf(core)).map((item) => item["handed_off"]),
      [false, false],
    );
    assertEquals(
      (await post(core, "user", "runs/list", {})).body["runs"],
      runsBefore.body["runs"],
    );
    assertEquals(
      (await post(core, "user", "sessions/list", {})).body["sessions"],
      sessionsBefore.body["sessions"],
    );
  });
});

Deno.test("documents/contexts#R25 [ctx-I58h]: the request text names each violation's file, section, rule and rule definition, and a long list is cut with the rest counted", () => {
  const one = violationRequestText({
    context: CONTEXT,
    violations: [{
      kind: "rule",
      rule: "Experiment.status-required",
      type: "Experiment",
      path: "eval/experiments/exp-002-b.md",
      section: "Result",
      target: "status",
      message: "status is required",
      rule_definition: { id: "status-required", when: "always" },
    }],
  });
  for (
    const part of [
      CONTEXT,
      "Experiment.status-required",
      "eval/experiments/exp-002-b.md",
      'section "Result"',
      "status is required",
      '"id":"status-required"',
    ]
  ) assert(one.includes(part), `${part} is missing from ${one}`);

  const many = Array.from({ length: 2000 }, (_, index) => ({
    kind: "rule",
    rule: "Experiment.status-required",
    path: `eval/experiments/exp-${index}.md`,
    section: null,
    target: null,
    message: "status is required",
    rule_definition: null,
  }));
  const cut = violationRequestText({ context: CONTEXT, violations: many });
  assert(
    new TextEncoder().encode(cut).length <= REQUEST_TEXT_MAX_BYTES + 200,
  );
  assert(cut.includes("eval/experiments/exp-0.md"));
  assert(!cut.includes("exp-1999.md"));
  assertEquals(cut.split("\n").at(-1)?.startsWith("... and "), true);
});
