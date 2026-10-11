// documents/contexts#R20·R21·R23·R25 [ctx-T9b]: 제품 core가 context worker를 실제 자식 프로세스로 띄우고
// 일을 보낸다. 임시 data root와 임시 Project 폴더(eval-project fixture의 사본)에서 context를 만들고,
// Context Engineer가 fixture 계약을 제출하면 worker가 snapshot에서 검사해 적용하고, 읽기가 worker가 쓴
// derived index로 답하고, 위반 수를 worker가 기록하는 흐름을 HTTP로 본다. 파일 끝은 같은 일을 보내는 core
// 쪽 규칙(따라잡기의 합치기·2초·기한, 검사 재시도, 낼 command의 중계·거절, launch 권한)을 fake로 본다.
import { assert, assertEquals } from "@std/assert";
import {
  err,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../packages/base/mod.ts";
import type { ContextWorkInput } from "../../packages/contracts/documents/mod.ts";
import type {
  CommandEnvelope,
  Writer,
} from "../../packages/platform/ledger/mod.ts";
import type { ReadHandler } from "../../packages/platform/api/mod.ts";
import {
  CONTEXT_INDEX_DEADLINE_MS,
  CONTEXT_INDEX_FRESH_MS,
  type ContextsProcess,
  contextsWorkerSpec,
  createContextsDispatcher,
  createContextsHost,
} from "./contexts-worker.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { sampleEnv } from "../../packages/documents/contexts/validate/sample.ts";
import { type Core, startCore } from "./core.ts";
import { createLedgerRegistration } from "./documents.ts";
import {
  createLedgerRegistration as createLophnAgentRegistration,
  lophnAgentDefinitions,
} from "./lophn-agent.ts";
import { closeUnlessKept } from "./testing/close-on-throw.ts";

const PROJECT = "prj_01kq12a1pha000000000000000";
const CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fav";
const FIXTURES = new URL(
  "../../packages/documents/contexts/testdata/",
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

async function open(
  home: string,
  folder: string,
): Promise<Core> {
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
    random: seededRandom(41),
    testCredentials: true,
    // 앱 쪽이 알려 주는 앱 read 명령의 효과(fixture 계약의 app-data type이 가리키는 명령)와 다른
    // context의 public type(fixture 관계의 `rubrics/Rubric`).
    contextCheckEnvironment: () =>
      Promise.resolve({
        appCommands: [
          { app: "calendar", command: "events.list", effect: "read" as const },
        ],
        externalTypes: sampleEnv().externalTypes.map((type) => ({
          ...type,
          fields: [...type.fields],
        })),
      }),
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
  const core = await open(home, folder);
  try {
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
async function submit(core: Core, content: Json, key: string): Promise<Json> {
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

async function bundleStatus(
  core: Core,
): Promise<{ bundle: Json; check: Json } | undefined> {
  const history = await post(core, "user", "contexts/bundles", {
    context: CONTEXT,
  });
  assertEquals(history.status, 200, JSON.stringify(history.body));
  const first = (history.body["bundles"] as { bundle: Json; check: Json }[])[0];
  return first?.bundle["status"] === "checking" ? undefined : first;
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
    user_saved_views: [],
    external_types: [],
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
    request: { context: string; check?: string },
  ) => Promise<Result<ContextWorkInput>>;
  request?: (op: string, payload: unknown) => Promise<Result<unknown>>;
  ensure?: () => Promise<boolean>;
  command?: (envelope: CommandEnvelope) => Promise<Result<unknown>>;
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

Deno.test("documents/contexts#R20 [ctx-T9b]: the worker is asked to run only when a bundle.submit was accepted, and the caller does not wait for the check", async () => {
  const host = createContextsHost();
  const seen: { context: string; check: string }[] = [];
  host.attach({
    ensureFresh: () => Promise.resolve({ stale: false }),
    runCheck: (request) => {
      seen.push(request);
      return new Promise(() => {});
    },
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
