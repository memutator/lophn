// documents/contexts#R20·R21·R23·R25 [ctx-T9b]: 제품 core가 context worker를 실제 자식 프로세스로 띄우고
// 일을 보낸다. 임시 data root와 임시 Project 폴더(eval-project fixture의 사본)에서 context를 만들고,
// Context Engineer가 fixture 계약을 제출하면 worker가 snapshot에서 검사해 적용하고, 읽기가 worker가 쓴
// derived index로 답하고, 위반 수를 worker가 기록하는 흐름을 HTTP로 본다. 파일 끝은 같은 일을 보내는 core
// 쪽 규칙(따라잡기의 합치기·2초·기한, 검사 재시도, 낼 command의 중계·거절, launch 권한)을 fake로 본다.
import { DatabaseSync } from "node:sqlite";
import { assert, assertEquals } from "@std/assert";
import {
  err,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../packages/base/mod.ts";
import type {
  ContextWorkInput,
  ContextWorkList,
} from "../../packages/protocol/projects/mod.ts";
import type {
  CommandEnvelope,
  Writer,
} from "../../packages/core/storage/ledger/mod.ts";
import type { ReadHandler } from "../../packages/core/server/mod.ts";
import {
  CONTEXT_INDEX_DEADLINE_MS,
  CONTEXT_INDEX_FRESH_MS,
  type ContextsProcess,
  contextsWorkerSpec,
  createContextsDispatcher,
  createContextsHost,
  createContextsProcess,
} from "./contexts-worker.ts";
import type { AuthenticatedContext } from "../../packages/protocol/server/mod.ts";
import { type Core, startCore } from "./core.ts";
import { createLedgerRegistration as createAppsRegistration } from "./apps.ts";
import { createLedgerRegistration } from "./documents.ts";
import {
  createLedgerRegistration as createLophnAgentRegistration,
  lophnAgentDefinitions,
} from "./lophn-agent.ts";
import { seedLedger } from "./testing/app-export-fixtures.ts";
import { closeUnlessKept } from "./testing/close-on-throw.ts";
import {
  CALENDAR_BLUEPRINT,
  RUBRIC_PATH,
  RUBRICS_CONTEXT,
  RUBRICS_TITLE,
  rubricsContract,
  writeRubricFiles,
} from "./contexts-testing.ts";

const PROJECT = "prj_01kq12a1pha000000000000000";
const CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fav";
const FIXTURES = new URL(
  "../../packages/core/projects/contexts/testdata/",
  import.meta.url,
);

type Json = Record<string, unknown>;
type Who = "user" | "engineer" | "admin";

const TOKENS: Record<Who, string> = {
  user: "u".repeat(43),
  engineer: "e".repeat(43),
  admin: "m".repeat(43),
};
const RUN_ENGINEER = "run_01arz3ndektsv4rrffq69g5fav";
const MESSAGE = "msg_01arz3ndektsv4rrffq69g5fav";

const USER_OPERATIONS = [
  "project.create",
  "context.create",
  "context.get",
  "context.draft",
  "context.bundles",
  "context.overview",
  "context.search",
  "context.entity",
  "context.violations",
  "context.preview",
];
const ENGINEER_OPERATIONS = [
  "bundle.save_draft",
  "bundle.submit",
  "context.get",
  "context.draft",
  "context.preview",
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
    credential_ref: `cred_contexts_worker_${who}`,
    scope: { operations: [...operations], targets: run ?? {} },
    conditions: run ?? {},
  } as AuthenticatedContext;
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

const command = (input: unknown, key: string, compare: unknown = {}) => ({
  input,
  idempotency_key: key,
  compare,
  prepared: [],
});

// eval-project fixture를 Project 폴더로 복사한다.
async function copyFixture(target: string): Promise<void> {
  const source = new URL("eval-project/", FIXTURES);
  const walk = async (directory: URL, relative: string) => {
    for await (const entry of Deno.readDir(directory)) {
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory) {
        await Deno.mkdir(`${target}/${child}`, { recursive: true });
        await walk(new URL(`${entry.name}/`, directory), child);
      } else {
        await Deno.copyFile(
          new URL(entry.name, directory),
          `${target}/${child}`,
        );
      }
    }
  };
  await walk(source, "");
}

async function fixtureContract(): Promise<Json> {
  return JSON.parse(
    await Deno.readTextFile(new URL("eval-project.contract.json", FIXTURES)),
  ) as Json;
}

// 제품 core의 기동 옵션. `worker`가 false면 context worker를 띄우지 않아 제출한 판이 checking으로 남는다.
function coreOptions(home: string, worker = true, seed = 41) {
  return {
    lophnHome: home,
    port: 0,
    teams: [
      { createLedgerRegistration },
      { lophnAgentDefinitions },
      { createLedgerRegistration: createLophnAgentRegistration },
      // 앱 등록: 검사 환경의 앱 command 효과는 앱 registry(apps·releases 표)에서 읽는다.
      { createLedgerRegistration: createAppsRegistration },
    ],
    teamModules: [
      new URL("./documents.ts", import.meta.url).href,
      new URL("./lophn-agent.ts", import.meta.url).href,
      new URL("./apps.ts", import.meta.url).href,
    ],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(seed),
    testCredentials: true,
    contextWorker: worker,
  };
}

async function open(
  home: string,
  folder: string,
  worker = true,
): Promise<Core> {
  const started = await startCore(coreOptions(home, worker));
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
    contextOf("user", "user", USER_OPERATIONS, "user-contexts-worker"),
    "user",
  );
  await login(
    contextOf(
      "admin",
      "machine",
      ["ListAssignments", "AcceptRun"],
      "admin-contexts-worker",
    ),
    "admin",
  );
  const assignments = await post(core, "admin", "assignments/list", {});
  assertEquals(assignments.status, 200, JSON.stringify(assignments.body));
  const engineer = (assignments.body["assignments"] as {
    id: string;
    role: string;
    revision: number;
  }[]).find((entry) => entry.role === "context_engineer");
  assert(engineer, "the product core prepares the builtin assignments");
  const accepted = await post(
    core,
    "admin",
    "runs/accept",
    command(
      {
        id: RUN_ENGINEER,
        assignment: engineer.id,
        session: null,
        source: { kind: "message", message: MESSAGE },
        continued_from: null,
        start_after: null,
      },
      "accept-run",
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
  return core;
}

async function withCore(
  run: (core: Core, home: string, folder: string) => Promise<void>,
): Promise<void> {
  const home = await Deno.makeTempDir({ prefix: "lophn-contexts-worker-" });
  const folder = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-contexts-worker-project-" }),
  );
  await copyFixture(folder);
  await writeRubricFiles(folder);
  const core = await open(home, folder);
  try {
    // fixture 계약이 기대는 환경을 진짜 데이터로 둔다: 같은 Project의 `rubrics` context와 앱 `calendar`.
    seedLedger(home, CALENDAR_BLUEPRINT, "b".repeat(64), 0);
    await applyRubrics(core);
    await run(core, home, folder);
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
    await Deno.remove(folder, { recursive: true });
  }
}

async function until<T>(
  what: string,
  read: () => Promise<T | undefined>,
  limitMs = 90_000,
): Promise<T> {
  const deadline = Date.now() + limitMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// 초안 저장 → 제출. worker가 검사를 끝낼 때까지 기다리지 않는다.
async function submit(
  core: Core,
  content: Json,
  key: string,
  target = { id: CONTEXT, title: "Evaluation" },
): Promise<Json> {
  const created = await post(
    core,
    "user",
    "contexts/create",
    command({
      id: target.id,
      project: PROJECT,
      title: target.title,
      purpose: "Experiments and their findings",
    }, `create-${key}`),
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
  return await resubmit(core, content, key, target.id);
}

// 이미 있는 context에 새 초안을 저장해 제출한다.
async function resubmit(
  core: Core,
  content: Json,
  key: string,
  context = CONTEXT,
): Promise<Json> {
  const draft = await post(
    core,
    "engineer",
    "contexts/save_draft",
    command({ context, content }, `draft-${key}`),
  );
  assertEquals(draft.status, 200, JSON.stringify(draft.body));
  const submitted = await post(
    core,
    "engineer",
    "contexts/submit_bundle",
    command({ bundle: draft.body["id"] }, `submit-${key}`),
  );
  assertEquals(submitted.status, 200, JSON.stringify(submitted.body));
  assertEquals(submitted.body["status"], "checking");
  return submitted.body;
}

// 이 시험은 복구만 본다. 다른 context와 앱이 필요한 부분(`rubrics/Rubric` 관계, 앱 데이터 type)을 뺀다:
// worker가 없는 첫 core에서는 `rubrics` context를 적용할 수 없다.
function withoutEnvironment(content: Json): Json {
  const copy = structuredClone(content) as {
    contract: { types: { name: string; relations: { name: string }[] }[] };
  };
  copy.contract.types = copy.contract.types.filter((type) =>
    type.name !== "Event"
  );
  for (const type of copy.contract.types) {
    type.relations = type.relations.filter((relation) =>
      relation.name !== "graded_by"
    );
  }
  return copy as unknown as Json;
}

async function bundleStatus(
  core: Core,
  context = CONTEXT,
): Promise<{ bundle: Json; check: Json } | undefined> {
  const history = await post(core, "user", "contexts/bundles", { context });
  assertEquals(history.status, 200, JSON.stringify(history.body));
  const first = (history.body["bundles"] as { bundle: Json; check: Json }[])[0];
  return first?.bundle["status"] === "checking" ? undefined : first;
}

// 같은 Project의 `rubrics` context에 Rubric 계약을 적용한다. fixture의 `rubrics/Rubric` 관계가 가리킨다.
async function applyRubrics(core: Core): Promise<void> {
  await submit(core, rubricsContract(), "rubrics", {
    id: RUBRICS_CONTEXT,
    title: RUBRICS_TITLE,
  });
  const done = await until(
    "the rubrics bundle",
    () => bundleStatus(core, RUBRICS_CONTEXT),
  );
  assertEquals(done.bundle["status"], "applied", JSON.stringify(done));
}

async function expectedEntities(): Promise<
  { type: string; key: string; fields: Json }[]
> {
  return JSON.parse(
    await Deno.readTextFile(
      new URL("expected/eval-project.entities.json", FIXTURES),
    ),
  );
}

Deno.test("documents/contexts#R20 #R21 [ctx-T9b]: submitting the fixture contract starts the worker, which checks a snapshot of the folder and applies the bundle", async () => {
  await withCore(async (core, home) => {
    await submit(core, await fixtureContract(), "pass");

    const finished = await until("the check result", () => bundleStatus(core));
    assertEquals(
      finished.bundle["status"],
      "applied",
      JSON.stringify(finished),
    );
    const check = finished.check as Json;
    assertEquals(check["status"], "passed");
    assertEquals(check["findings"], []);
    // 위반은 실패 사유가 아니라 기록이다: 규칙 4개와 추출 3개
    assertEquals(check["violation_count"], 7);
    assert(/^[0-9a-f]{64}$/.test(String(check["snapshot_hash"])));

    const got = await post(core, "user", "contexts/get", { context: CONTEXT });
    assertEquals((got.body["context"] as Json)["status"], "active");

    // snapshot은 check가 끝나면 지운다.
    const staging = `${home}/documents/staging/context-check`;
    const left = [];
    for await (const entry of Deno.readDir(staging)) left.push(entry.name);
    assertEquals(left, []);
  });
});

Deno.test("documents/contexts#R14 #R12 #R20 [ctx-I36]: the fixture contract passes the check with the real rubrics context and the calendar app, and context.entity reaches the rubric of another context", async () => {
  await withCore(async (core) => {
    await submit(core, await fixtureContract(), "environment");
    const finished = await until("the check result", () => bundleStatus(core));
    assertEquals(
      finished.bundle["status"],
      "applied",
      JSON.stringify(finished),
    );
    assertEquals(finished.check["status"], "passed");
    assertEquals(finished.check["findings"], []);

    // 읽는 쪽 index: Evaluation은 읽기 전 따라잡기가, rubrics는 자기 읽기가 채운다.
    const overview = await post(core, "user", "contexts/overview", {
      context: RUBRICS_CONTEXT,
    });
    assertEquals(overview.status, 200, JSON.stringify(overview.body));
    assertEquals(overview.body["types"], [{ type: "Rubric", count: 1 }]);

    const entity = await post(core, "user", "contexts/entity", {
      context: CONTEXT,
      type: "Experiment",
      key: "001",
    });
    assertEquals(entity.status, 200, JSON.stringify(entity.body));
    const relations = entity.body["relations"] as {
      name: string;
      targets: Json[];
    }[];
    assertEquals(
      relations.find((relation) => relation.name === "graded_by")!.targets,
      [{
        context: RUBRICS_CONTEXT,
        type: "Rubric",
        key: "schedule-quality",
        path: RUBRIC_PATH,
        section: null,
      }],
    );
    // 같은 context의 관계 대상 ref에는 context가 없다.
    const runsOn = relations.find((relation) => relation.name === "runs_on")!;
    assert(runsOn.targets.length > 0);
    for (const target of runsOn.targets) assert(!("context" in target));

    // 대상 context를 읽어도 같은 개체다: ref로 그 context의 개체를 연다.
    const rubric = await post(core, "user", "contexts/entity", {
      context: RUBRICS_CONTEXT,
      type: "Rubric",
      key: "schedule-quality",
    });
    assertEquals(rubric.status, 200, JSON.stringify(rubric.body));
    assertEquals((rubric.body["ref"] as Json)["path"], RUBRIC_PATH);
  });
});

Deno.test("documents/contexts#R14 #R12 #R20 [ctx-I36]: a relation to a context that does not exist and an app command that is not read fail the check with the reason", async () => {
  await withCore(async (core) => {
    const ghost = await fixtureContract();
    const experiment = (ghost["contract"] as {
      types: { relations: { name: string; to: string }[] }[];
    }).types[0]!;
    experiment.relations.find((relation) => relation.name === "graded_by")!
      .to = "ghost/Rubric";
    await submit(core, ghost, "ghost");
    const first = await until("the ghost check", () => bundleStatus(core));
    assertEquals(first.bundle["status"], "failed", JSON.stringify(first));
    assertEquals(
      (first.check["findings"] as Json[]).map((finding) => [
        finding["kind"],
        finding["detail"],
      ]),
      [["contract_invalid", "relation_target_unknown"]],
    );

    const writes = await fixtureContract();
    const event = (writes["contract"] as {
      types: { name: string; source: { command?: string } }[];
    }).types.find((type) => type.name === "Event")!;
    event.source.command = "events.create";
    await resubmit(core, writes, "writes");
    const second = await until("the write check", async () => {
      const history = await post(core, "user", "contexts/bundles", {
        context: CONTEXT,
      });
      const bundles = history.body["bundles"] as {
        bundle: Json;
        check: Json;
      }[];
      const top = bundles[0];
      return top?.bundle["status"] === "checking" ||
          top?.bundle["id"] === first.bundle["id"]
        ? undefined
        : top;
    });
    assertEquals(second.bundle["status"], "failed", JSON.stringify(second));
    assertEquals(
      (second.check["findings"] as Json[]).map((finding) => [
        finding["kind"],
        finding["detail"],
      ]),
      [["contract_invalid", "app_command_not_read"]],
    );
  });
});

Deno.test("documents/contexts#R23 #R25 [ctx-T9b]: search and overview read the index the worker wrote, and the worker records the violation count", async () => {
  await withCore(async (core, home) => {
    await submit(core, await fixtureContract(), "read");
    await until("the applied bundle", () => bundleStatus(core));

    // 읽기 전에 따라잡기: 처음 읽는 검색이 index를 채운 뒤 답한다.
    const entities = await expectedEntities();
    const running = entities.filter((entity) =>
      entity.type === "Experiment" && entity.fields["status"] === "running"
    ).map((entity) => entity.key);
    const board = await post(core, "user", "contexts/search", {
      context: CONTEXT,
      search: "experiments_by_status",
      inputs: { status: ["running"] },
    });
    assertEquals(board.status, 200, JSON.stringify(board.body));
    const rows = board.body["rows"] as { ref: { key: string } }[];
    assertEquals(rows.map((row) => row.ref.key), running);

    const findings = await post(core, "user", "contexts/search", {
      context: CONTEXT,
      search: "findings_for_experiment",
      inputs: { experiment: "001" },
    });
    assertEquals(findings.status, 200, JSON.stringify(findings.body));
    assertEquals(
      (findings.body["rows"] as { ref: { key: string } }[]).map((row) =>
        row.ref.key
      ),
      ["001"],
    );

    // 개수는 fixture가 기대하는 개체 수와 같다. 앱 데이터(Event)는 index에 저장하지 않으므로 0이다.
    const overview = await post(core, "user", "contexts/overview", {
      context: CONTEXT,
    });
    assertEquals(overview.status, 200, JSON.stringify(overview.body));
    const counts = Object.fromEntries(
      (overview.body["types"] as { type: string; count: number }[]).map((
        entry,
      ) => [entry.type, entry.count]),
    );
    const expected: Record<string, number> = {};
    for (const entity of entities) {
      expected[entity.type] = (expected[entity.type] ?? 0) +
        (entity.type === "Event" ? 0 : 1);
    }
    assertEquals(counts, expected);
    assertEquals(overview.body["violation_count"], 7);

    // worker가 위반 수를 core에 기록했다(마지막 기록과 달랐으므로).
    const recorded = await until("the recorded violation count", async () => {
      const got = await post(core, "user", "contexts/get", {
        context: CONTEXT,
      });
      const mark = (got.body["context"] as Json)["violation_mark"];
      return mark === 7 ? mark : undefined;
    });
    assertEquals(recorded, 7);

    // 규칙 위반이 위반 목록에 있다.
    const violations = await post(core, "user", "contexts/violations", {
      context: CONTEXT,
    });
    assertEquals(violations.status, 200, JSON.stringify(violations.body));
    const items = violations.body["violations"] as Json[];
    assertEquals(
      items.filter((item) => item["kind"] === "rule").map((
        item,
      ) => [item["rule"], item["path"]]),
      [
        ["Experiment.status-known", "eval/experiments/exp-003-paused.md"],
        ["Experiment.status-required", "eval/experiments/exp-004-nostatus.md"],
        ["Experiment.scenarios-exist", "eval/experiments/exp-010-tiller.md"],
        ["Finding.about-exists", "loop/findings/F-003.md"],
      ],
    );

    // derived index는 worker가 만들었다.
    const stat = await Deno.stat(`${home}/derived/contexts.sqlite`);
    assert(stat.isFile);
  });
});

Deno.test("documents/contexts#R23 [ctx-T9b]: a file edited after the first scan shows up on the next read and the recorded count follows", async () => {
  await withCore(async (core, _home, folder) => {
    await submit(core, await fixtureContract(), "edit");
    await until("the applied bundle", () => bundleStatus(core));
    const first = await post(core, "user", "contexts/overview", {
      context: CONTEXT,
    });
    assertEquals(first.body["violation_count"], 7);
    await until("the first record", async () => {
      const got = await post(core, "user", "contexts/get", {
        context: CONTEXT,
      });
      return (got.body["context"] as Json)["violation_mark"] === 7
        ? true
        : undefined;
    });

    // 직전 scan이 끝난 지 2초 안의 읽기는 새로 훑지 않는다. 그 뒤 편집은 다음 읽기에 보인다.
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    const path = `${folder}/eval/experiments/exp-003-paused.md`;
    const text = await Deno.readTextFile(path);
    await Deno.writeTextFile(
      path,
      text.replace("status: paused", "status: done"),
    );

    const second = await post(core, "user", "contexts/overview", {
      context: CONTEXT,
    });
    assertEquals(second.status, 200, JSON.stringify(second.body));
    assertEquals(second.body["violation_count"], 6);
    await until("the lowered record", async () => {
      const got = await post(core, "user", "contexts/get", {
        context: CONTEXT,
      });
      return (got.body["context"] as Json)["violation_mark"] === 6
        ? true
        : undefined;
    });
  });
});

Deno.test("documents/contexts#R20 [ctx-T9b]: a bundle whose example no longer holds is reported failed and never applied", async () => {
  await withCore(async (core, home) => {
    const content = await fixtureContract();
    (content["examples"] as { expect?: { fields: Json } }[])[1]!.expect!
      .fields["status"] = "done";
    await submit(core, content, "fail");

    const finished = await until("the check result", () => bundleStatus(core));
    assertEquals(finished.bundle["status"], "failed", JSON.stringify(finished));
    const check = finished.check as Json;
    assertEquals(check["status"], "failed");
    assertEquals(
      (check["findings"] as Json[]).map((finding) => [
        finding["kind"],
        finding["target"],
      ]),
      [["example_mismatch", "examples.1"]],
    );

    // 적용되지 않았고 snapshot도 남지 않았다.
    const got = await post(core, "user", "contexts/get", { context: CONTEXT });
    assertEquals((got.body["context"] as Json)["status"], "drafting");
    const left = [];
    for await (
      const entry of Deno.readDir(`${home}/documents/staging/context-check`)
    ) left.push(entry.name);
    assertEquals(left, []);
  });
});

// 맥락을 만들고 초안만 저장한다(제출하지 않는다). 초안 판의 id를 돌려준다.
async function saveDraft(
  core: Core,
  content: Json,
  key: string,
): Promise<string> {
  const created = await post(
    core,
    "user",
    "contexts/create",
    command({
      id: CONTEXT,
      project: PROJECT,
      title: "Evaluation",
      purpose: "Experiments and their findings",
    }, `create-${key}`),
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
  const draft = await post(
    core,
    "engineer",
    "contexts/save_draft",
    command({ context: CONTEXT, content }, `draft-${key}`),
  );
  assertEquals(draft.status, 200, JSON.stringify(draft.body));
  return String(draft.body["id"]);
}

// derived index에 그 context의 행이 몇 개 있는가. index 파일이 없으면 0이다.
async function indexedRows(home: string, context: string): Promise<number> {
  if (!(await exists(`${home}/derived/contexts.sqlite`))) return 0;
  const db = new DatabaseSync(`${home}/derived/contexts.sqlite`, {
    readOnly: true,
  });
  try {
    let rows = 0;
    for (const table of ["index_state", "index_files", "index_entities"]) {
      const found = db.prepare(
        `SELECT count(*) AS n FROM ${table} WHERE context = ?`,
      ).get(context) as { n: number | bigint };
      rows += Number(found.n);
    }
    return rows;
  } finally {
    db.close();
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test("documents/contexts#R19 #R24 [ctx-I64p]: previewing a drafting context's draft counts the entities and lists the violations from the project files, and applies and indexes nothing", async () => {
  await withCore(async (core, home, folder) => {
    const bundle = await saveDraft(core, await fixtureContract(), "preview");
    const before = await post(core, "user", "contexts/get", {
      context: CONTEXT,
    });

    const shown = await post(core, "engineer", "contexts/preview", {
      context: CONTEXT,
      bundle,
    });
    assertEquals(shown.status, 200, JSON.stringify(shown.body));
    assertEquals(shown.body["context"], CONTEXT);
    assertEquals(shown.body["bundle"], bundle);
    // 앱 데이터는 읽지 않으므로 Event는 0이고 나머지는 정답 개체 수다.
    const expected = await expectedEntities();
    const counted = (type: string) =>
      expected.filter((entity) => entity.type === type).length;
    assertEquals(shown.body["types"], [
      { type: "Experiment", count: counted("Experiment") },
      { type: "Scenario", count: counted("Scenario") },
      { type: "Finding", count: counted("Finding") },
      { type: "Decision", count: counted("Decision") },
      { type: "Guide", count: counted("Guide") },
      { type: "GuideHeading", count: counted("GuideHeading") },
      { type: "Event", count: 0 },
    ]);
    assertEquals(shown.body["findings"], []);
    assertEquals(shown.body["violation_count"], 7);
    const violations = shown.body["violations"] as Json[];
    assertEquals(violations.length, 7);
    assert(violations.every((violation) => violation["message"] !== ""));
    assertEquals(
      violations.map((violation) => violation["path"]),
      [...violations.map((violation) => String(violation["path"]))].sort(),
    );
    assertEquals(shown.body["complete"], true);
    assertEquals(shown.body["next_cursor"], null);

    // 사람도 읽는다.
    const byUser = await post(core, "user", "contexts/preview", {
      context: CONTEXT,
      bundle,
    });
    assertEquals(byUser.status, 200, JSON.stringify(byUser.body));
    assertEquals(byUser.body["violations"], shown.body["violations"]);

    // 아무것도 적용하거나 쓰지 않았다: 판은 draft이고 context는 만드는 중이며 revision이 그대로다.
    const after = await post(core, "user", "contexts/get", {
      context: CONTEXT,
    });
    assertEquals(after.body, before.body);
    assertEquals((after.body["context"] as Json)["status"], "drafting");
    const history = await post(core, "user", "contexts/bundles", {
      context: CONTEXT,
    });
    assertEquals(
      (history.body["bundles"] as { bundle: Json }[]).map((entry) =>
        entry.bundle["status"]
      ),
      ["draft"],
    );
    // 이 context의 index는 건드리지 않았고(`rubrics`의 index는 있다) snapshot은 남지 않았다.
    assertEquals(await indexedRows(home, CONTEXT), 0);
    const left = [];
    for await (
      const entry of Deno.readDir(`${home}/documents/staging/context-check`)
    ) left.push(entry.name);
    assertEquals(left, []);

    // 호출마다 지금 파일을 읽는다: 새 파일은 새 개체이고 그 위반이다.
    await Deno.copyFile(
      `${folder}/eval/experiments/exp-004-nostatus.md`,
      `${folder}/eval/experiments/exp-011-new.md`,
    );
    const again = await post(core, "user", "contexts/preview", {
      context: CONTEXT,
      bundle,
    });
    assertEquals(again.status, 200, JSON.stringify(again.body));
    assertEquals((again.body["types"] as Json[])[0], {
      type: "Experiment",
      count: counted("Experiment") + 1,
    });
    assertEquals(again.body["violation_count"], 8);
  });
});

Deno.test("documents/contexts#R19 [ctx-I64p]: a failing example of the draft is shown as a finding while the counts and violations stay", async () => {
  await withCore(async (core) => {
    const content = await fixtureContract();
    (content["examples"] as { expect?: { fields: Json } }[])[1]!.expect!
      .fields["status"] = "done";
    const bundle = await saveDraft(core, content, "example");
    const shown = await post(core, "user", "contexts/preview", {
      context: CONTEXT,
      bundle,
    });
    assertEquals(shown.status, 200, JSON.stringify(shown.body));
    assertEquals(
      (shown.body["findings"] as Json[]).map((finding) => [
        finding["kind"],
        finding["target"],
      ]),
      [["example_mismatch", "examples.1"]],
    );
    assertEquals((shown.body["types"] as Json[]).length, 7);
    assertEquals(shown.body["violation_count"], 7);
  });
});

Deno.test("documents/contexts#R19 [ctx-I64p]: a bundle that is not the context's draft is conflict, an unknown or another context's bundle is not_found, and a cursor from another bundle is invalid_input", async () => {
  await withCore(async (core) => {
    const content = await fixtureContract();
    await submit(core, content, "conflict");
    const finished = await until("the check result", () => bundleStatus(core));
    const bundle = String(finished.bundle["id"]);
    assertEquals(finished.bundle["status"], "applied");

    // 적용된 판은 draft가 아니다.
    const applied = await post(core, "user", "contexts/preview", {
      context: CONTEXT,
      bundle,
    });
    assertEquals(applied.status, 409, JSON.stringify(applied.body));

    const unknown = await post(core, "user", "contexts/preview", {
      context: CONTEXT,
      bundle: "cbn_00000000000000000000000001",
    });
    assertEquals(unknown.status, 404, JSON.stringify(unknown.body));

    const other = await post(core, "user", "contexts/preview", {
      context: "ctx_00000000000000000000000001",
      bundle,
    });
    assertEquals(other.status, 404, JSON.stringify(other.body));

    // 적용된 context에 새 draft를 저장해 그 판에 다른 판의 cursor를 물린다.
    const draft = await post(
      core,
      "engineer",
      "contexts/save_draft",
      command({ context: CONTEXT, content }, "draft-next"),
    );
    assertEquals(draft.status, 200, JSON.stringify(draft.body));
    const foreign = await post(core, "user", "contexts/preview", {
      context: CONTEXT,
      bundle: draft.body["id"],
      cursor: btoa(encodeURIComponent(JSON.stringify({
        scope: `context.preview:${bundle}`,
        after: ["a"],
      }))),
    });
    assertEquals(foreign.status, 400, JSON.stringify(foreign.body));
    const fine = await post(core, "user", "contexts/preview", {
      context: CONTEXT,
      bundle: draft.body["id"],
    });
    assertEquals(fine.status, 200, JSON.stringify(fine.body));
  });
});

Deno.test("documents/contexts#R20 [ctx-I67]: a check whose answer was never received stays checking until the next core start, which sends it to the worker and applies the bundle", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-contexts-worker-" });
  const folder = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-contexts-worker-project-" }),
  );
  await copyFixture(folder);
  try {
    // no worker is running: the submitted candidate stays checking
    const first = await open(home, folder, false);
    try {
      await submit(
        first,
        withoutEnvironment(await fixtureContract()),
        "recover",
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      const history = await post(first, "user", "contexts/bundles", {
        context: CONTEXT,
      });
      const bundles = history.body["bundles"] as { bundle: Json }[];
      assertEquals(bundles[0]!.bundle["status"], "checking");
    } finally {
      await first.shutdown();
    }

    // the next start sweeps the running check and the worker finishes it
    const started = await startCore(coreOptions(home, true, 42));
    assert(started.ok, started.ok ? "" : JSON.stringify(started.error));
    const second = started.value;
    try {
      const login = contextOf(
        "user",
        "user",
        USER_OPERATIONS,
        "user-contexts-worker",
      );
      const accepted = await second.acceptTestCredential!(login, TOKENS.user);
      assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
      // the credential record of the first start is still in the ledger
      const done = await until(
        "the recovered check",
        () => bundleStatus(second),
      );
      assertEquals(done.bundle["status"], "applied");
      assertEquals(done.check["status"], "passed");
    } finally {
      await second.shutdown();
    }
  } finally {
    await Deno.remove(home, { recursive: true });
    await Deno.remove(folder, { recursive: true });
  }
});

Deno.test("documents/contexts#R23 [ctx-I67]: core reads the active context list with a machine reader and never builds a reader that acts as the user", async () => {
  const source = await Deno.readTextFile(new URL("./core.ts", import.meta.url));
  // every reader context core builds for the context worker and the watch is a machine
  const readers = [...source.matchAll(
    /principal: "(machine:contexts-[a-z-]+)",\s+actor: "([a-z]+)"/g,
  )];
  assertEquals(readers.map((match) => match[1]), ["machine:contexts-dispatch"]);
  assertEquals(readers.map((match) => match[2]), ["machine"]);
  assert(!source.includes("machine:contexts-watch"));
  assert(!source.includes("contextListRoute"));
  assert(source.includes("contextWorkListRoute"));
});

// ---------- core가 worker에 일을 보내는 규칙(worker와 ledger는 fake) ----------

const DISPATCH_CONTEXT = "ctx_00000000000000000000000001";
const CHECK = "chk_00000000000000000000000001";
const HASH = "a".repeat(64);
const SNAPSHOT = "b".repeat(64);

function input(extra: Partial<ContextWorkInput> = {}): ContextWorkInput {
  return {
    context: DISPATCH_CONTEXT,
    roots: ["/work/project"],
    recorded_count: 0,
    applied: {
      bundle_hash: HASH,
      content: { schema: 1 } as never,
    },
    candidate: null,
    draft: null,
    user_saved_views: [],
    external_types: [],
    app_commands: [],
    as_of_seq: "1",
    next_cursor: null,
    ...extra,
  };
}

const indexAnswer = (submissions: unknown[] = []) => ({
  scanned: 3,
  changed: 3,
  removed: 0,
  extracted: true,
  violation_count: 2,
  submissions,
});

const record = {
  command: "context.record_violations",
  input: { context: DISPATCH_CONTEXT, count: 2, bundle_hash: HASH },
};
const finish = (extra: Record<string, unknown> = {}) => ({
  command: "bundle.finish_check",
  input: {
    check: CHECK,
    result: "passed",
    bundle_hash: HASH,
    snapshot_hash: SNAPSHOT,
    findings: [],
    violation_count: 2,
    ...extra,
  },
});

function setup(options: {
  read?: (
    request: { context: string; check?: string; bundle?: string },
  ) => Promise<Result<ContextWorkInput>>;
  request?: (op: string, payload: unknown) => Promise<Result<unknown>>;
  ensure?: () => Promise<boolean>;
  command?: (envelope: CommandEnvelope) => Promise<Result<unknown>>;
  list?: () => Promise<Result<ContextWorkList>>;
} = {}) {
  const requests: { op: string; payload: unknown }[] = [];
  const commands: CommandEnvelope[] = [];
  const reads: unknown[] = [];
  const ensured: (readonly string[])[] = [];
  const logs: string[] = [];
  let now = 0;
  const sleeps: number[] = [];
  const process: ContextsProcess = {
    ensure: (roots) => {
      ensured.push(roots);
      return options.ensure?.() ?? Promise.resolve(true);
    },
    retain: () => Promise.resolve(),
    request: (op, payload) => {
      requests.push({ op, payload });
      return options.request?.(op, payload) ??
        Promise.resolve(ok(indexAnswer()));
    },
  };
  const dispatcher = createContextsDispatcher({
    process,
    readInput: (request) => {
      reads.push(request);
      return options.read?.(request) ?? Promise.resolve(ok(input()));
    },
    command: (envelope) => {
      commands.push(envelope);
      return options.command?.(envelope) ?? Promise.resolve(ok({}));
    },
    ...(options.list ? { list: options.list } : {}),
    nowMs: () => now,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    log: (message) => logs.push(message),
  });
  return {
    dispatcher,
    requests,
    commands,
    reads,
    ensured,
    logs,
    sleeps,
    advance: (ms: number) => now += ms,
  };
}

Deno.test("documents/contexts#R23 [ctx-T9b]: ensureFresh sends the applied bundle with the folders, and a second read inside two seconds sends nothing", async () => {
  const run = setup();
  assertEquals(await run.dispatcher.ensureFresh(DISPATCH_CONTEXT), {
    stale: false,
  });
  assertEquals(run.requests.length, 1);
  assertEquals(run.requests[0]!.op, "context.index");
  assertEquals(run.requests[0]!.payload, {
    context: DISPATCH_CONTEXT,
    bundle: { schema: 1 },
    bundle_hash: HASH,
    recorded_count: 0,
    roots: ["/work/project"],
  });
  assertEquals(run.ensured, [["/work/project"]]);

  run.advance(CONTEXT_INDEX_FRESH_MS - 1);
  assertEquals(await run.dispatcher.ensureFresh(DISPATCH_CONTEXT), {
    stale: false,
  });
  assertEquals(run.requests.length, 1);
  run.advance(1);
  await run.dispatcher.ensureFresh(DISPATCH_CONTEXT);
  assertEquals(run.requests.length, 2);
});

Deno.test("documents/contexts#R23 [ctx-T9b]: reads that arrive while a scan is running share it", async () => {
  let release: (answer: Result<unknown>) => void = () => {};
  const run = setup({
    request: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const first = run.dispatcher.ensureFresh(DISPATCH_CONTEXT);
  const second = run.dispatcher.ensureFresh(DISPATCH_CONTEXT);
  await new Promise((resolve) => setTimeout(resolve, 5));
  release(ok(indexAnswer()));
  assertEquals(await first, { stale: false });
  assertEquals(await second, { stale: false });
  assertEquals(run.requests.length, 1);
});

Deno.test("documents/contexts#R23 [ctx-T9b]: a scan that outlasts the deadline lets the read answer from the index it has, marked stale, and still finishes", async () => {
  let release: (answer: Result<unknown>) => void = () => {};
  const run = setup({
    request: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const started = performance.now();
  assertEquals(await run.dispatcher.ensureFresh(DISPATCH_CONTEXT), {
    stale: true,
  });
  assert(performance.now() - started >= CONTEXT_INDEX_DEADLINE_MS - 50);
  // 기다리던 scan은 이어서 끝나고 다음 읽기가 그 결과를 쓴다.
  release(ok(indexAnswer([record])));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assertEquals(run.commands.length, 1);
  assertEquals(await run.dispatcher.ensureFresh(DISPATCH_CONTEXT), {
    stale: false,
  });
  assertEquals(run.requests.length, 1);
});

Deno.test("documents/contexts#R23 [ctx-T9b]: a context without an applied bundle is not scanned and a worker that cannot run leaves the read on the old index", async () => {
  const drafting = setup({
    read: () => Promise.resolve(ok(input({ applied: null }))),
  });
  assertEquals(await drafting.dispatcher.ensureFresh(DISPATCH_CONTEXT), {
    stale: false,
  });
  assertEquals(drafting.requests.length, 0);
  assertEquals(drafting.ensured.length, 0);

  const down = setup({ ensure: () => Promise.resolve(false) });
  assertEquals(await down.dispatcher.ensureFresh(DISPATCH_CONTEXT), {
    stale: true,
  });
  assertEquals(down.requests.length, 0);
  // 실패는 기억하지 않는다. 다음 읽기가 다시 시도한다.
  await down.dispatcher.ensureFresh(DISPATCH_CONTEXT);
  assertEquals(down.ensured.length, 2);

  const unreadable = setup({
    read: () => Promise.resolve(err({ code: "unavailable", message: "x" })),
  });
  assertEquals(await unreadable.dispatcher.ensureFresh(DISPATCH_CONTEXT), {
    stale: true,
  });
});

Deno.test("documents/contexts#R25 [ctx-T9b]: the violation count the worker asks for is submitted with the narrow credential, bound to the applied bundle", async () => {
  const run = setup({
    request: () => Promise.resolve(ok(indexAnswer([record]))),
  });
  await run.dispatcher.ensureFresh(DISPATCH_CONTEXT);
  assertEquals(run.commands.length, 1);
  assertEquals(run.commands[0]!.command, "context.record_violations");
  assertEquals(run.commands[0]!.input, record.input);
  assert(run.commands[0]!.idempotency_key.startsWith("context-worker/"));
  assertEquals(run.commands[0]!.prepared, []);
});

Deno.test("documents/contexts#R25 [ctx-T9b]: a submission for another context or another bundle, or of another command, is refused and never submitted", async () => {
  for (
    const forged of [
      {
        ...record,
        input: { ...record.input, context: "ctx_00000000000000000000000002" },
      },
      { ...record, input: { ...record.input, bundle_hash: "c".repeat(64) } },
      // 검사 결과는 index 요청에 실려 올 수 없다.
      finish(),
    ]
  ) {
    const run = setup({
      request: () => Promise.resolve(ok(indexAnswer([forged]))),
    });
    await run.dispatcher.ensureFresh(DISPATCH_CONTEXT);
    assertEquals(run.commands, [], JSON.stringify(forged));
  }
});

const candidate = () =>
  input({
    applied: null,
    candidate: {
      check: CHECK,
      bundle_hash: HASH,
      content: { schema: 1 },
    },
  });

const checkAnswer = (submissions: unknown[]) => ({
  status: "passed",
  snapshot_hash: SNAPSHOT,
  violation_count: 2,
  submissions,
});

Deno.test("documents/contexts#R20 [ctx-T9b]: a check sends the candidate with the saved views and relays the result, then the applied bundle is scanned at once", async () => {
  const run = setup({
    read: (request) =>
      Promise.resolve(ok(request.check === undefined ? input() : candidate())),
    request: (op) =>
      Promise.resolve(
        ok(op === "context.check" ? checkAnswer([finish()]) : indexAnswer()),
      ),
  });
  assertEquals(
    await run.dispatcher.runCheck({ context: DISPATCH_CONTEXT, check: CHECK }),
    true,
  );
  assertEquals(run.reads[0], { context: DISPATCH_CONTEXT, check: CHECK });
  const sent = run.requests[0]!;
  assertEquals(sent.op, "context.check");
  assertEquals((sent.payload as Record<string, unknown>)["bundle"], {
    schema: 1,
  });
  assertEquals((sent.payload as Record<string, unknown>)["check"], CHECK);
  assertEquals(run.commands.length, 1);
  assertEquals(run.commands[0]!.command, "bundle.finish_check");
  assertEquals(
    run.commands[0]!.idempotency_key,
    `context-worker/finish/${CHECK}/${SNAPSHOT}/passed`,
  );
  // 적용 직후 첫 scan: 새 판은 모든 파일을 다시 extract한다
  await new Promise((resolve) => setTimeout(resolve, 20));
  assertEquals(run.requests.map((entry) => entry.op), [
    "context.check",
    "context.index",
  ]);
});

Deno.test("documents/contexts#R14 #R12 [ctx-I36]: a check and a preview send the other contexts' types and the app command effects exactly as context.work_input read them", async () => {
  const environment = {
    external_types: [{
      context: "rubrics",
      name: "Rubric",
      visibility: "public" as const,
      key: "id",
      fields: [{
        name: "id",
        visibility: "public" as const,
        value_type: "string",
      }],
    }],
    app_commands: [{
      app: "calendar",
      command: "events.list",
      effect: "read" as const,
    }],
  };
  const run = setup({
    read: (request) =>
      Promise.resolve(ok(
        request.bundle !== undefined
          ? { ...draftInput(), ...environment }
          : request.check === undefined
          ? input()
          : { ...candidate(), ...environment },
      )),
    request: (op) =>
      Promise.resolve(
        ok(
          op === "context.check"
            ? checkAnswer([finish()])
            : op === "context.preview"
            ? previewAnswer(0)
            : indexAnswer(),
        ),
      ),
  });
  assertEquals(
    await run.dispatcher.runCheck({ context: DISPATCH_CONTEXT, check: CHECK }),
    true,
  );
  const checked = run.requests.find((entry) => entry.op === "context.check")!;
  const check = checked.payload as Record<string, unknown>;
  assertEquals(check["external_types"], environment.external_types);
  assertEquals(check["app_commands"], environment.app_commands);

  const previewed = await run.dispatcher.preview({
    context: DISPATCH_CONTEXT,
    bundle: PREVIEW_BUNDLE,
  });
  assert(previewed.ok, JSON.stringify(previewed));
  const preview = run.requests.find((entry) => entry.op === "context.preview")!
    .payload as Record<string, unknown>;
  assertEquals(preview["external_types"], environment.external_types);
  assertEquals(preview["app_commands"], environment.app_commands);
});

Deno.test("documents/contexts#R20 [ctx-T9b]: a result for another check or bundle is refused, and a check with nothing to check sends nothing", async () => {
  const run = setup({
    read: () => Promise.resolve(ok(candidate())),
    request: () =>
      Promise.resolve(
        ok(checkAnswer([finish({ bundle_hash: "c".repeat(64) })])),
      ),
  });
  assertEquals(
    await run.dispatcher.runCheck({ context: DISPATCH_CONTEXT, check: CHECK }),
    false,
  );
  assertEquals(run.commands, []);

  const done = setup({ read: () => Promise.resolve(ok(input())) });
  assertEquals(
    await done.dispatcher.runCheck({ context: DISPATCH_CONTEXT, check: CHECK }),
    true,
  );
  assertEquals(done.requests, []);
});

Deno.test("documents/contexts#R20 [ctx-T9b]: a check whose answer is lost is sent again a limited number of times and never reported as passed", async () => {
  let attempts = 0;
  const run = setup({
    read: () => Promise.resolve(ok(candidate())),
    request: () => {
      attempts += 1;
      return Promise.resolve(err({ code: "unavailable", message: "gone" }));
    },
  });
  assertEquals(
    await run.dispatcher.runCheck({ context: DISPATCH_CONTEXT, check: CHECK }),
    false,
  );
  assertEquals(attempts, 3);
  assertEquals(run.sleeps, [1_000, 3_000]);
  assertEquals(run.commands, []);

  // 거절은 다시 보내지 않는다.
  let refusals = 0;
  const refused = setup({
    read: () => Promise.resolve(ok(candidate())),
    request: () => {
      refusals += 1;
      return Promise.resolve(err({ code: "invalid_input", message: "no" }));
    },
  });
  assertEquals(
    await refused.dispatcher.runCheck({
      context: DISPATCH_CONTEXT,
      check: CHECK,
    }),
    false,
  );
  assertEquals(refusals, 1);
});

const PREVIEW_BUNDLE = "cbn_00000000000000000000000001";
const draftInput = () =>
  input({
    applied: null,
    draft: { bundle: PREVIEW_BUNDLE, content: { schema: 1 } },
  });
const violation = (path: string) => ({
  kind: "unreadable",
  rule: null,
  type: "Experiment",
  path,
  section: null,
  target: null,
});
const previewAnswer = (count = 3) => ({
  types: [{ type: "Experiment", count }],
  findings: [],
  violation_count: count,
  violations: Array.from(
    { length: count },
    (_, index) => violation(`a/${String(index).padStart(3, "0")}.md`),
  ),
});

Deno.test("documents/contexts#R19 [ctx-I64p]: a preview sends the draft with the folders and the environment, pages the violations by 30 with messages and binds the cursor to the bundle", async () => {
  const run = setup({
    read: () => Promise.resolve(ok(draftInput())),
    request: () => Promise.resolve(ok(previewAnswer(65))),
  });
  const first = await run.dispatcher.preview({
    context: DISPATCH_CONTEXT,
    bundle: PREVIEW_BUNDLE,
  });
  assert(first.ok, JSON.stringify(first));
  assertEquals(run.reads, [{
    context: DISPATCH_CONTEXT,
    bundle: PREVIEW_BUNDLE,
  }]);
  assertEquals(run.requests.length, 1);
  assertEquals(run.requests[0]!.op, "context.preview");
  assertEquals(run.requests[0]!.payload, {
    context: DISPATCH_CONTEXT,
    draft: { schema: 1 },
    roots: ["/work/project"],
    external_types: [],
    app_commands: [],
  });
  assertEquals(first.value.violation_count, 65);
  assertEquals(first.value.violations.length, 30);
  assertEquals(first.value.complete, false);
  assertEquals(first.value.types, [{ type: "Experiment", count: 65 }]);
  assertEquals(
    first.value.violations[0]!.message,
    "a/000.md cannot be read",
  );

  const second = await run.dispatcher.preview({
    context: DISPATCH_CONTEXT,
    bundle: PREVIEW_BUNDLE,
    cursor: first.value.next_cursor!,
  });
  assert(second.ok);
  assertEquals(second.value.violations[0]!.path, "a/030.md");
  const third = await run.dispatcher.preview({
    context: DISPATCH_CONTEXT,
    bundle: PREVIEW_BUNDLE,
    cursor: second.value.next_cursor!,
  });
  assert(third.ok);
  assertEquals(third.value.violations.length, 5);
  assertEquals(third.value.complete, true);
  assertEquals(third.value.next_cursor, null);
  // 호출마다 worker가 새로 추출한다.
  assertEquals(run.requests.length, 3);
  // preview는 command를 내지 않는다.
  assertEquals(run.commands, []);

  // 다른 판의 cursor는 worker를 부르기 전에 invalid_input이다.
  const other = await run.dispatcher.preview({
    context: DISPATCH_CONTEXT,
    bundle: "cbn_00000000000000000000000002",
    cursor: first.value.next_cursor!,
  });
  assert(!other.ok);
  assertEquals(other.error.code, "invalid_input");
  assertEquals(run.requests.length, 3);
});

Deno.test("documents/contexts#R19 [ctx-I64p]: a preview that cannot be made is unavailable, never a partial result, and the ledger's not_found and conflict pass through", async () => {
  const stopped = setup({
    read: () => Promise.resolve(ok(draftInput())),
    request: () =>
      Promise.resolve(err({ code: "unavailable", message: "over budget" })),
  });
  const failed = await stopped.dispatcher.preview({
    context: DISPATCH_CONTEXT,
    bundle: PREVIEW_BUNDLE,
  });
  assert(!failed.ok);
  assertEquals(failed.error.code, "unavailable");

  const down = setup({
    read: () => Promise.resolve(ok(draftInput())),
    ensure: () => Promise.resolve(false),
  });
  const notRun = await down.dispatcher.preview({
    context: DISPATCH_CONTEXT,
    bundle: PREVIEW_BUNDLE,
  });
  assert(!notRun.ok);
  assertEquals(notRun.error.code, "unavailable");
  assertEquals(down.requests, []);

  for (const code of ["not_found", "conflict"] as const) {
    const refused = setup({
      read: () => Promise.resolve(err({ code, message: code })),
    });
    const result = await refused.dispatcher.preview({
      context: DISPATCH_CONTEXT,
      bundle: PREVIEW_BUNDLE,
    });
    assert(!result.ok);
    assertEquals(result.error.code, code);
    assertEquals(refused.requests, []);
  }

  const bad = setup({
    read: () => Promise.resolve(ok(draftInput())),
    request: () => Promise.resolve(ok({ nope: true })),
  });
  const invalid = await bad.dispatcher.preview({
    context: DISPATCH_CONTEXT,
    bundle: PREVIEW_BUNDLE,
  });
  assert(!invalid.ok);
  assertEquals(invalid.error.code, "internal");
});

Deno.test("documents/contexts#R20 [ctx-T9b]: the worker is asked to run only when a bundle.submit was accepted, and the caller does not wait for the check", async () => {
  const host = createContextsHost();
  const seen: { context: string; check: string }[] = [];
  host.attach({
    ensureFresh: () => Promise.resolve({ stale: false }),
    runCheck: (request) => {
      seen.push(request);
      return new Promise(() => {});
    },
    recover: () => Promise.resolve(0),
    preview: () => Promise.resolve(err({ code: "unavailable", message: "x" })),
  });
  const inner: Writer = {
    command: (_ctx, envelope) =>
      Promise.resolve(
        envelope.command === "bundle.submit"
          ? ok({
            result: {
              context: DISPATCH_CONTEXT,
              check: CHECK,
              status: "checking",
            },
          } as never)
          : envelope.command === "bundle.rollback"
          ? err({ code: "conflict", message: "no" })
          : ok(
            { result: { context: DISPATCH_CONTEXT, check: CHECK } } as never,
          ),
      ),
    readResult: () => Promise.resolve(ok(null)),
    close: () => Promise.resolve(),
  };
  const writer = host.wrapWriter(inner);
  const envelope = (command: string): CommandEnvelope => ({
    command,
    input: {},
    idempotency_key: command,
    compare: {},
    prepared: [],
  });
  const ctx = {} as never;
  assert((await writer.command(ctx, envelope("bundle.submit"))).ok);
  assertEquals(seen, [{ context: DISPATCH_CONTEXT, check: CHECK }]);
  await writer.command(ctx, envelope("bundle.save_draft"));
  await writer.command(ctx, envelope("bundle.rollback"));
  assertEquals(seen.length, 1);
});

Deno.test("documents/contexts#R23 [ctx-T9b]: only the reads that use the index catch it up first, once a dispatcher is attached", async () => {
  const host = createContextsHost();
  const calls: string[] = [];
  const handler = (name: string): ReadHandler => () => {
    calls.push(`read:${name}`);
    return ok({});
  };
  const reads = new Map<string, ReadHandler>([
    ["contexts/search", handler("search")],
    ["contexts/overview", handler("overview")],
    ["contexts/entity", handler("entity")],
    ["contexts/series_next", handler("series_next")],
    ["contexts/input_options", handler("input_options")],
    ["contexts/get", handler("get")],
    ["contexts/list", handler("list")],
    ["contexts/draft", handler("draft")],
  ]);
  host.overlayReads(reads);
  const ctx = {} as never;
  // dispatcher가 없으면 지나간다.
  await reads.get("contexts/search")!(ctx, { context: DISPATCH_CONTEXT });
  assertEquals(calls, ["read:search"]);

  calls.length = 0;
  host.attach({
    ensureFresh: (context) => {
      calls.push(`fresh:${context}`);
      return Promise.resolve({ stale: false });
    },
    runCheck: () => Promise.resolve(true),
    recover: () => Promise.resolve(0),
    preview: () => Promise.resolve(err({ code: "unavailable", message: "x" })),
  });
  for (const key of reads.keys()) {
    await reads.get(key)!(ctx, { context: DISPATCH_CONTEXT });
  }
  assertEquals(calls, [
    `fresh:${DISPATCH_CONTEXT}`,
    "read:search",
    `fresh:${DISPATCH_CONTEXT}`,
    "read:overview",
    `fresh:${DISPATCH_CONTEXT}`,
    "read:entity",
    `fresh:${DISPATCH_CONTEXT}`,
    "read:series_next",
    `fresh:${DISPATCH_CONTEXT}`,
    "read:input_options",
    `fresh:${DISPATCH_CONTEXT}`,
    "read:get",
    // 목록과 초안은 index를 읽지 않는다.
    "read:list",
    "read:draft",
  ]);

  // context가 아닌 입력은 따라잡지 않고 그대로 읽는다.
  calls.length = 0;
  await reads.get("contexts/search")!(ctx, { context: "nope" });
  assertEquals(calls, ["read:search"]);
});

Deno.test("documents/contexts#R20 [ctx-T9b]: the worker may read the project folders and write only its index and snapshot folder, with no network, env or subprocess", () => {
  const spec = contextsWorkerSpec({
    dataRoot: "/data/lophn",
    roots: ["/work/a", "/work/b", "/data/lophn"],
  });
  assert(spec !== undefined);
  assertEquals(spec.kind, "documents/contexts");
  assertEquals(spec.allow_write, [
    "/data/lophn/derived/contexts.sqlite",
    "/data/lophn/derived/contexts.sqlite-wal",
    "/data/lophn/derived/contexts.sqlite-shm",
    "/data/lophn/derived/contexts.sqlite-journal",
    "/data/lophn/documents/staging/context-check",
  ]);
  assert(spec.allow_read.includes("/work/a"));
  assert(spec.allow_read.includes("/work/b"));
  // lophn 데이터 root 전체는 읽지 않는다.
  assert(!spec.allow_read.includes("/data/lophn"));
  assertEquals(
    [spec.allow_net, spec.allow_run, spec.allow_sys, spec.allow_env],
    [[], [], [], []],
  );
  assert(spec.entry.endsWith("/apps/worker/documents/contexts.ts"));
  // 쉼표가 든 폴더는 권한 목록에 넣을 수 없어 띄우지 않는다.
  assertEquals(
    contextsWorkerSpec({ dataRoot: "/data/lophn", roots: ["/work/a,/"] }),
    undefined,
  );
});

// ---------- 시작 때 다시 보내기 · 읽을 폴더 맞추기 · preview와 다른 일 ----------

const listOf = (
  checks: { context: string; check: string; roots?: string[] }[],
): ContextWorkList => ({
  contexts: [],
  checks: checks.map((entry) => ({ roots: ["/work/project"], ...entry })),
  as_of_seq: "1",
  next_cursor: null,
});

Deno.test("documents/contexts#R20 [ctx-I67]: recover sends again a check that is still running, relays its result, and sends nothing when the list is empty or unreadable", async () => {
  const run = setup({
    list: () =>
      Promise.resolve(
        ok(listOf([{ context: DISPATCH_CONTEXT, check: CHECK }])),
      ),
    read: (request) =>
      Promise.resolve(ok(request.check === undefined ? input() : candidate())),
    request: (op) =>
      Promise.resolve(
        ok(op === "context.check" ? checkAnswer([finish()]) : indexAnswer()),
      ),
  });
  assertEquals(await run.dispatcher.recover(), 1);
  assertEquals(run.requests[0]!.op, "context.check");
  assertEquals(run.commands.map((entry) => entry.command), [
    "bundle.finish_check",
  ]);

  const empty = setup({
    list: () => Promise.resolve(ok(listOf([]))),
  });
  assertEquals(await empty.dispatcher.recover(), 0);
  assertEquals(empty.requests, []);

  const broken = setup({
    list: () =>
      Promise.resolve(err({ code: "unavailable", message: "ledger is busy" })),
  });
  assertEquals(await broken.dispatcher.recover(), 0);
  assertEquals(broken.requests, []);
  assert(broken.logs.some((line) => line.includes("ledger is busy")));

  // a core assembled without the list has nothing to recover
  assertEquals(await setup().dispatcher.recover(), 0);
});

Deno.test("documents/contexts#R20 [ctx-I67]: a check that is already being sent is not sent a second time by recover, and a recovered check whose answer is lost again stays checking", async () => {
  const release: (() => void)[] = [];
  const held = setup({
    list: () =>
      Promise.resolve(
        ok(listOf([{ context: DISPATCH_CONTEXT, check: CHECK }])),
      ),
    read: () => Promise.resolve(ok(candidate())),
    request: () =>
      new Promise((resolve) =>
        release.push(() => resolve(ok(checkAnswer([finish()]))))
      ),
  });
  const first = held.dispatcher.runCheck({
    context: DISPATCH_CONTEXT,
    check: CHECK,
  });
  const recovered = held.dispatcher.recover();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(held.requests.length, 1);
  release[0]!();
  assertEquals(await first, true);
  assertEquals(await recovered, 1);
  assertEquals(held.commands.length, 1);

  // three lost answers in a row: nothing is reported, the next start tries again
  const lost = setup({
    list: () =>
      Promise.resolve(
        ok(listOf([{ context: DISPATCH_CONTEXT, check: CHECK }])),
      ),
    read: () => Promise.resolve(ok(candidate())),
    request: () =>
      Promise.resolve(err({ code: "unavailable", message: "gone" })),
  });
  assertEquals(await lost.dispatcher.recover(), 1);
  assertEquals(lost.requests.length, 3);
  assertEquals(lost.commands, []);
});

Deno.test("documents/contexts#R20 [ctx-I67]: a preview does not wait for the index scan or the check of its context", async () => {
  // The preview reads copy the files into a snapshot of their own and write neither the index nor the ledger, so
  // core sends it at once even while another job of the same context is running in the worker.
  let release!: () => void;
  const run = setup({
    read: (request) =>
      Promise.resolve(
        ok(request.bundle !== undefined ? draftInput() : input()),
      ),
    request: (op) =>
      op === "context.index"
        ? new Promise((resolve) => release = () => resolve(ok(indexAnswer())))
        : Promise.resolve(ok(previewAnswer(1))),
  });
  const scanning = run.dispatcher.ensureFresh(DISPATCH_CONTEXT);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(run.requests.map((entry) => entry.op), ["context.index"]);
  const previewed = await run.dispatcher.preview({
    context: DISPATCH_CONTEXT,
    bundle: PREVIEW_BUNDLE,
  });
  assert(previewed.ok, JSON.stringify(previewed));
  assertEquals(run.requests.map((entry) => entry.op), [
    "context.index",
    "context.preview",
  ]);
  release();
  assertEquals(await scanning, { stale: false });
});

// ---------- worker가 읽을 폴더 집합 ----------

function fakeSupervisor() {
  const launches: { how: "start" | "update"; read: string[] }[] = [];
  const spec = (value: unknown) =>
    (value as { allow_read: string[] }).allow_read;
  const supervisor = {
    start(value: unknown) {
      launches.push({ how: "start", read: spec(value) });
      return Promise.resolve({ ok: true as const, value: undefined });
    },
    updateSpec(value: unknown) {
      launches.push({ how: "update", read: spec(value) });
      return Promise.resolve({ ok: true as const, value: undefined });
    },
    send: () => Promise.resolve({ ok: true as const, value: undefined }),
  };
  return { supervisor, launches };
}

function processOf() {
  const { supervisor, launches } = fakeSupervisor();
  const process = createContextsProcess({
    supervisor: supervisor as never,
    channel: {
      request: () => Promise.resolve(ok({})),
      onMessage: () => {},
      bind: () => {},
      failPending: () => {},
    },
    dataRoot: "/data/lophn",
    epoch: "epoch",
    apiPort: 1,
    prepare: () => Promise.resolve(),
  });
  const projects = () =>
    launches.map((launch) =>
      launch.read.filter((path) => path.startsWith("/work/"))
    );
  return { process, launches, projects };
}

Deno.test("documents/contexts#R20 [ctx-I67]: the worker is launched again without the folders core no longer lists, and a list with no folder removed leaves the launch alone", async () => {
  const { process, launches, projects } = processOf();

  // no worker yet: nothing to shrink
  await process.retain(["/work/a"]);
  assertEquals(launches, []);

  await process.ensure(["/work/a", "/work/b"]);
  await process.ensure(["/work/c"]);
  assertEquals(projects(), [["/work/a", "/work/b"], [
    "/work/a",
    "/work/b",
    "/work/c",
  ]]);
  assertEquals(launches.map((launch) => launch.how), ["start", "update"]);

  // a folder was removed from its project: the launch drops it
  await process.retain(["/work/a", "/work/c"]);
  assertEquals(projects()[2], ["/work/a", "/work/c"]);
  assertEquals(launches[2]!.how, "update");

  // nothing removed, or folders core does not know yet: no launch
  await process.retain(["/work/a", "/work/c"]);
  await process.retain(["/work/a", "/work/c", "/work/z"]);
  assertEquals(launches.length, 3);

  // a context of the removed folder asks again and brings it back
  await process.ensure(["/work/b"]);
  assertEquals(projects()[3], ["/work/a", "/work/b", "/work/c"]);
});
