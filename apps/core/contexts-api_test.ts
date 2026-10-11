// documents/contexts#R19·R21·R26, documents/terms#R1·R10 [ctx-T9a]: 새 context API가 실제 core에
// 등록돼 있다. 임시 data root에서 core를 띄우고(사람 데이터 root는 열지 않는다) 사람이 context를 만들고,
// Context Engineer가 초안을 저장해 제출하고, context worker의 좁은 자격이 검사를 끝내 적용하고, 읽기와
// 용어집이 그 결과를 돌려주는 흐름을 HTTP로 본다. 옛 route는 등록에서 빠져 404다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import {
  openIndexStore,
  scanContext,
} from "../../packages/documents/contexts/index/mod.ts";
import {
  evalContent,
  minimalContent,
} from "../../packages/documents/contexts/api/testing.ts";
import {
  fixtureBundle,
  memoryFiles,
  scanInput,
} from "../../packages/documents/contexts/index/testing.ts";
import { type Core, startCore } from "./core.ts";
import { contextWorkerCredential } from "./contexts-api.ts";
import { createLedgerRegistration } from "./documents.ts";
import {
  createLedgerRegistration as createLophnAgentRegistration,
  lophnAgentDefinitions,
} from "./lophn-agent.ts";
import { closeUnlessKept } from "./testing/close-on-throw.ts";

const PROJECT = "prj_01kq12a1pha000000000000000";
const CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fav";
const ENTRY = "trm_01arz3ndektsv4rrffq69g5fav";
const SHA = "a".repeat(64);

type Json = Record<string, unknown>;
type Who = "user" | "engineer" | "worker" | "other-agent" | "admin";

const TOKENS: Record<Who, string> = {
  user: "u".repeat(43),
  engineer: "e".repeat(43),
  worker: "w".repeat(43),
  "other-agent": "o".repeat(43),
  admin: "m".repeat(43),
};
const RUN_ENGINEER = "run_01arz3ndektsv4rrffq69g5fav";
const RUN_OTHER = "run_01arz3ndektsv4rrffq69g5faw";
const MESSAGES = {
  [RUN_ENGINEER]: "msg_01arz3ndektsv4rrffq69g5fav",
  [RUN_OTHER]: "msg_01arz3ndektsv4rrffq69g5faw",
};

const USER_OPERATIONS = [
  "ListAssignments",
  "project.create",
  "context.create",
  "context.archive",
  "context.unarchive",
  "context.list",
  "context.get",
  "context.contract",
  "context.draft",
  "context.bundles",
  "context.hand_off_violations",
  "context.overview",
  "context.search",
  "context.entity",
  "context.series_next",
  "context.violations",
  "glossary.set",
  "glossary.list",
];
const ENGINEER_OPERATIONS = [
  "bundle.save_draft",
  "bundle.submit",
  "context.get",
  "context.draft",
  "glossary.set",
];

function contextOf(
  who: Who,
  actor: string,
  operations: readonly string[],
  principal: string,
  run?: { assignment: string; run: string },
): AuthenticatedContext {
  // agent 자격은 접수된 Run에 묶인다(platform/ledger#R11).
  return {
    principal,
    actor,
    credential_ref: `cred_contexts_${who}`,
    scope: { operations: [...operations], targets: run ?? {} },
    conditions: run ?? {},
  } as AuthenticatedContext;
}

async function open(
  home: string,
  folder: string,
): Promise<{ core: Core; engineer: string }> {
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
    contextOf("user", "user", USER_OPERATIONS, "user-contexts"),
    "user",
  );
  // 내장 Context Engineer·lophn assignment마다 Run 하나를 접수해 agent 자격을 묶는다.
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
  const other = listed.find((entry) => entry.role === "lophn");
  assert(
    engineer && other,
    "the product core prepares the builtin assignments",
  );
  for (
    const [assignment, run] of [
      [engineer, RUN_ENGINEER],
      [other, RUN_OTHER],
    ] as const
  ) {
    const accepted = await post(
      core,
      "admin",
      "runs/accept",
      command(
        {
          id: run,
          assignment: assignment.id,
          session: null,
          source: { kind: "message", message: MESSAGES[run] },
          continued_from: null,
          start_after: null,
        },
        `accept-${run}`,
        { assignment_revision: assignment.revision },
      ),
    );
    assertEquals(accepted.status, 200, JSON.stringify(accepted.body));
  }
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
  // lophn 역할의 agent는 같은 operation을 가져도 Context Engineer가 아니다.
  await login(
    contextOf(
      "other-agent",
      `agent:${other.id}`,
      ENGINEER_OPERATIONS,
      `agent:${other.id}`,
      { assignment: other.id, run: RUN_OTHER },
    ),
    "other-agent",
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
  return { core, engineer: engineer.id };
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

function command(
  input: unknown,
  key: string,
  compare: unknown = {},
) {
  return { input, idempotency_key: key, compare, prepared: [] };
}

async function withCore(
  run: (core: Core, engineer: string) => Promise<void>,
): Promise<void> {
  const home = await Deno.makeTempDir({ prefix: "lophn-contexts-api-" });
  const folder = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-contexts-api-folder-" }),
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

async function create(core: Core): Promise<Json> {
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
  return created.body;
}

// 초안 저장 → 제출 → worker 자격의 통과 보고로 판 하나를 적용하고 그 판의 id와 hash를 돌려준다.
async function apply(
  core: Core,
  content: Record<string, unknown> = minimalContent(),
): Promise<{ bundle: string; hash: string }> {
  const draft = await post(
    core,
    "engineer",
    "contexts/save_draft",
    command({ context: CONTEXT, content }, "draft-apply"),
  );
  assertEquals(draft.status, 200, JSON.stringify(draft.body));
  const submitted = await post(
    core,
    "engineer",
    "contexts/submit_bundle",
    command({ bundle: draft.body["id"] }, "submit-apply"),
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
    }, "finish-apply"),
  );
  assertEquals(finished.status, 200, JSON.stringify(finished.body));
  return { bundle: String(draft.body["id"]), hash };
}

Deno.test("documents/contexts#R1 [ctx-T9a]: a user creates a context that starts drafting and lists it", async () => {
  await withCore(async (core) => {
    const context = await create(core);
    assertEquals(context["status"], "drafting");
    assertEquals(context["applied_bundle"], null);

    const listed = await post(core, "user", "contexts/list", {
      project: PROJECT,
    });
    assertEquals(listed.status, 200, JSON.stringify(listed.body));
    const contexts = listed.body["contexts"] as Json[];
    assertEquals(contexts.map((entry) => entry["id"]), [CONTEXT]);
    assertEquals(contexts[0]["status"], "drafting");
    assertEquals(contexts[0]["draft_bundle"], null);

    const got = await post(core, "user", "contexts/get", { context: CONTEXT });
    assertEquals(got.status, 200, JSON.stringify(got.body));
    assertEquals((got.body["context"] as Json)["id"], CONTEXT);
    assertEquals(got.body["applied"], null);
  });
});

Deno.test("documents/contexts#R19 #R21 [ctx-T9a]: the Context Engineer saves a draft and submits it, and the worker credential's passing check applies it", async () => {
  await withCore(async (core) => {
    await create(core);

    // 역할이 Context Engineer가 아닌 agent는 초안을 쓸 수 없다.
    const refused = await post(
      core,
      "other-agent",
      "contexts/save_draft",
      command({ context: CONTEXT, content: minimalContent() }, "other-draft"),
    );
    assertEquals(refused.status, 403, JSON.stringify(refused.body));

    const draft = await post(
      core,
      "engineer",
      "contexts/save_draft",
      command({ context: CONTEXT, content: minimalContent() }, "draft-1"),
    );
    assertEquals(draft.status, 200, JSON.stringify(draft.body));
    assertEquals(draft.body["status"], "draft");
    const bundle = String(draft.body["id"]);

    // 만드는 중인 판의 내용은 blob에서 읽혀 돌아온다.
    const reading = await post(core, "engineer", "contexts/draft", {
      context: CONTEXT,
    });
    assertEquals(reading.status, 200, JSON.stringify(reading.body));
    const progress = reading.body["draft"] as Json;
    assertEquals(progress["step"], 2);
    assertEquals(progress["content"], minimalContent());

    const submitted = await post(
      core,
      "engineer",
      "contexts/submit_bundle",
      command({ bundle }, "submit-1"),
    );
    assertEquals(submitted.status, 200, JSON.stringify(submitted.body));
    assertEquals(submitted.body["status"], "checking");
    assertEquals(submitted.body["number"], 1);
    const check = String(submitted.body["check"]);
    const bundleHash = String(submitted.body["bundle_hash"]);
    assert(/^[0-9a-f]{64}$/.test(bundleHash));

    // 사람과 Context Engineer는 검사 결과를 낼 수 없다.
    const forged = await post(
      core,
      "engineer",
      "contexts/record_check",
      command({
        check,
        result: "passed",
        bundle_hash: bundleHash,
        snapshot_hash: SHA,
        findings: [],
        violation_count: 0,
      }, "forged"),
    );
    assert(forged.status >= 400, JSON.stringify(forged.body));

    const finished = await post(
      core,
      "worker",
      "contexts/record_check",
      command({
        check,
        result: "passed",
        bundle_hash: bundleHash,
        snapshot_hash: SHA,
        findings: [],
        violation_count: 0,
      }, "finish-1"),
    );
    assertEquals(finished.status, 200, JSON.stringify(finished.body));
    assertEquals((finished.body["context"] as Json)["status"], "active");
    assertEquals((finished.body["bundle"] as Json)["status"], "applied");
    assertEquals((finished.body["check"] as Json)["status"], "passed");

    // 읽기가 적용된 결과를 돌려준다.
    const got = await post(core, "user", "contexts/get", { context: CONTEXT });
    assertEquals(got.status, 200, JSON.stringify(got.body));
    assertEquals((got.body["context"] as Json)["status"], "active");
    assertEquals((got.body["applied"] as Json)["id"], bundle);

    const listed = await post(core, "user", "contexts/list", {
      project: PROJECT,
    });
    assertEquals(listed.status, 200, JSON.stringify(listed.body));
    const line = (listed.body["contexts"] as Json[])[0];
    assertEquals(line["status"], "active");
    assertEquals(line["applied_number"], 1);

    const contract = await post(core, "user", "contexts/contract", {
      context: CONTEXT,
    });
    assertEquals(contract.status, 200, JSON.stringify(contract.body));
    assertEquals(contract.body["bundle"], bundle);
    assertEquals(contract.body["bundle_hash"], bundleHash);
    assertEquals(
      (contract.body["content"] as { contract: { types: Json[] } }).contract
        .types.map((type) => type["name"]),
      ["Experiment"],
    );

    const history = await post(core, "user", "contexts/bundles", {
      context: CONTEXT,
    });
    assertEquals(history.status, 200, JSON.stringify(history.body));
    assertEquals(
      (history.body["bundles"] as { bundle: Json }[]).map((entry) =>
        entry.bundle["status"]
      ),
      ["applied"],
    );
  });
});

Deno.test("documents/terms#R1 #R10 [ctx-T9a]: a glossary entry is set by the user and listed in term order", async () => {
  await withCore(async (core) => {
    await create(core);
    const set = await post(
      core,
      "user",
      "terms/set",
      command({
        id: ENTRY,
        context: CONTEXT,
        term: "Arm",
        meaning: "One configuration compared in an experiment",
      }, "set-arm"),
    );
    assertEquals(set.status, 200, JSON.stringify(set.body));
    assertEquals(set.body["set_by"], "user");

    const listed = await post(core, "user", "terms/list", {
      context: CONTEXT,
    });
    assertEquals(listed.status, 200, JSON.stringify(listed.body));
    assertEquals(
      (listed.body["entries"] as Json[]).map((entry) => [
        entry["term"],
        entry["set_by"],
      ]),
      [["Arm", "user"]],
    );
  });
});

Deno.test("documents/contexts#R1 [ctx-T9a]: the old context, term, saved view and outline routes are not served", async () => {
  await withCore(async (core) => {
    for (
      const path of [
        "terms/define",
        "terms/propose",
        "contexts/export",
        "contexts/watch",
        "contexts/related",
        "contexts/set_item",
        "views/open",
        "views/list",
        "outline/context",
      ]
    ) {
      const response = await post(core, "user", path, {});
      assertEquals(response.status, 404, `${path}: ${response.status}`);
    }
  });
});

Deno.test("documents/contexts#R23 #R24 #R25 [ctx-T9a]: entities and violations come from the derived index, and handing violations off is unavailable until a Run can be started", async () => {
  await withCore(async (core) => {
    await create(core);
    const { hash } = await apply(core);

    // index가 아직 없으면 빈 결과로 꾸미지 않고 unavailable이다.
    const before = await post(core, "user", "contexts/overview", {
      context: CONTEXT,
    });
    assertEquals(before.status, 503, JSON.stringify(before.body));

    // context worker가 쓰는 derived index(여기서는 같은 표를 직접 채운다).
    await Deno.mkdir(`${core.dataRoot}/derived`, { recursive: true });
    const store = openIndexStore(`${core.dataRoot}/derived/contexts.sqlite`);
    try {
      store.transaction((sql) => {
        sql.run(
          `INSERT INTO index_state (context, bundle_hash, scanned_at, result)
           VALUES (?, ?, ?, 'complete')`,
          [CONTEXT, hash, "2024-01-01T00:00:00.000Z"],
        );
        sql.run(
          `INSERT INTO index_entities
             (context, ord, type, id, path, section, fields, links, source_kind)
           VALUES (?, 0, 'Experiment', '001', 'eval/experiments/exp-001-a.md',
                   NULL, ?, '[]', 'series')`,
          [CONTEXT, JSON.stringify({ id: "001", status: "running" })],
        );
        sql.run(
          `INSERT INTO index_violations
             (context, ord, kind, rule, type, path, section, target)
           VALUES (?, 0, 'rule', 'status-required', 'Experiment',
                   'eval/experiments/exp-002-b.md', NULL, 'status')`,
          [CONTEXT],
        );
      });
    } finally {
      store.close();
    }

    const overview = await post(core, "user", "contexts/overview", {
      context: CONTEXT,
    });
    assertEquals(overview.status, 200, JSON.stringify(overview.body));
    assertEquals(overview.body["types"], [{ type: "Experiment", count: 1 }]);

    const searched = await post(core, "user", "contexts/search", {
      context: CONTEXT,
      search: "experiments_by_status",
      inputs: {},
    });
    assertEquals(searched.status, 200, JSON.stringify(searched.body));
    assertEquals(
      (searched.body["rows"] as { ref: Json }[]).map((row) => row.ref["key"]),
      ["001"],
    );

    const violations = await post(core, "user", "contexts/violations", {
      context: CONTEXT,
    });
    assertEquals(violations.status, 200, JSON.stringify(violations.body));
    const listed = violations.body["violations"] as Json[];
    assertEquals(listed.map((item) => [item["rule"], item["handed_off"]]), [[
      "status-required",
      false,
    ]]);

    // Run을 시작하는 port가 아직 없다. 가짜 Run을 만들지 않고 unavailable로 답해 아무것도 남기지 않는다.
    const handed = await post(
      core,
      "user",
      "contexts/hand_off_violations",
      command({ context: CONTEXT }, "hand-off"),
    );
    assertEquals(handed.status, 503, JSON.stringify(handed.body));
    const after = await post(core, "user", "contexts/violations", {
      context: CONTEXT,
    });
    assertEquals(
      (after.body["violations"] as Json[]).map((item) => item["handed_off"]),
      [false],
    );
  });
});

// eval-project 계약을 적용하고 그 fixture 파일을 context worker와 같은 scan으로 index에 채운다.
async function applyScanned(core: Core): Promise<void> {
  const { hash } = await apply(core, evalContent());
  await Deno.mkdir(`${core.dataRoot}/derived`, { recursive: true });
  const store = openIndexStore(`${core.dataRoot}/derived/contexts.sqlite`);
  try {
    const scanned = scanContext(
      store,
      scanInput(memoryFiles(), {
        context: CONTEXT,
        bundle: fixtureBundle(),
        bundle_hash: hash,
      }),
    );
    assert(scanned.ok, JSON.stringify(scanned));
  } finally {
    store.close();
  }
}

Deno.test("documents/contexts#R16 [ctx-I63]: context.entity reads one entity of the scanned index with its fields and relation targets, and refuses what it cannot read", async () => {
  await withCore(async (core) => {
    await create(core);
    await applyScanned(core);
    const read = (type: string, key: string, context = CONTEXT) =>
      post(core, "user", "contexts/entity", { context, type, key });

    const one = await read("Experiment", "002");
    assertEquals(one.status, 200, JSON.stringify(one.body));
    assertEquals(one.body["ref"], {
      type: "Experiment",
      key: "002",
      path: "eval/experiments/exp-002-sight.md",
      section: null,
    });
    const relations = one.body["relations"] as {
      name: string;
      targets: Json[];
    }[];
    assertEquals(relations.map((relation) => relation.name), [
      "runs_on",
      "graded_by",
    ]);
    assertEquals(
      relations[0]!.targets.map((target) => target["key"]),
      ["schedule-basic", "travel"],
    );
    assertEquals(relations[1]!.targets, []);

    // a relation target opens by its own ref
    const target = relations[0]!.targets[0]!;
    const opened = await read(String(target["type"]), String(target["key"]));
    assertEquals(opened.status, 200, JSON.stringify(opened.body));
    assertEquals(opened.body["ref"], target);

    assertEquals((await read("Experiment", "999")).status, 404);
    assertEquals((await read("Nothing", "001")).status, 400);
    assertEquals(
      (await read("Experiment", "001", "ctx_01arz3ndektsv4rrffq69g5faw"))
        .status,
      404,
    );
  });
});

Deno.test("documents/series#R5 [ctx-I63]: context.series_next gives the next name from the scanned index, and invalid_input for a type that is not a series", async () => {
  await withCore(async (core) => {
    await create(core);
    await applyScanned(core);
    const next = (type: string, context = CONTEXT) =>
      post(core, "user", "contexts/series_next", { context, type });

    const experiment = await next("Experiment");
    assertEquals(experiment.status, 200, JSON.stringify(experiment.body));
    assertEquals(
      experiment.body["pattern"],
      "eval/experiments/exp-{n:03}-*.md",
    );
    assertEquals(experiment.body["next"], {
      key: "011",
      path: "eval/experiments/exp-011-*.md",
      from: "eval/experiments/exp-010-tiller.md",
      complete: false,
      taken: false,
    });
    const finding = await next("Finding");
    assertEquals(
      (finding.body["next"] as Json)["path"],
      "loop/findings/F-004.md",
    );

    assertEquals((await next("Scenario")).status, 400);
    assertEquals((await next("Nothing")).status, 400);
    assertEquals(
      (await next("Experiment", "ctx_01arz3ndektsv4rrffq69g5faw")).status,
      404,
    );
  });
});
