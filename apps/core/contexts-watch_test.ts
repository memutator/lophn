// documents/contexts#R23 [ctx-T9d]: core가 활성 context의 계약 경로 폴더만 `Deno.watchFs`로 보고, 바뀌면 사람이
// 읽지 않아도 그 context의 index를 따라잡아 위반 수를 기록한다. 앞은 fake 감시 source와 fake timer로 보는
// 감시 집합·합침·다시 정하기이고, 끝은 제품 core와 실제 worker로 임시 Project 폴더를 고쳐 보는 흐름이다.
import { assert, assertEquals } from "@std/assert";
import {
  err,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../packages/base/mod.ts";
import {
  bundleContentSchema,
  type ContextWorkInput,
  type ContextWorkList,
} from "../../packages/contracts/documents/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import {
  contractOf,
  fakeTimer,
  fakeWatchFs,
} from "../../packages/documents/contexts/watch/testing.ts";
import { sampleEnv } from "../../packages/documents/contexts/validate/sample.ts";
import { createContextsWatch } from "./contexts-watch.ts";
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
  "context.list",
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
async function submit(core: Core, content: Json, key: string): Promise<void> {
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
}

// context.list는 index를 따라잡는 읽기가 아니다. 기록된 위반 수만 읽는다.
async function recordedCount(core: Core): Promise<number | undefined> {
  const listed = await post(core, "user", "contexts/list", {
    project: PROJECT,
  });
  assertEquals(listed.status, 200, JSON.stringify(listed.body));
  const found = (listed.body["contexts"] as Json[]).find((item) =>
    item["id"] === CONTEXT
  );
  const mark = found?.["violation_mark"];
  return typeof mark === "number" ? mark : undefined;
}

Deno.test("documents/contexts#R23 [ctx-T9d]: editing a contract folder raises the recorded violation count with no read call", async () => {
  await withCore(async (core, _home, folder) => {
    await submit(core, await fixtureContract(), "watch");
    // 적용 직후 첫 scan이 위반 7개를 기록한다.
    await until(
      "the first record",
      async () => (await recordedCount(core)) === 7 ? true : undefined,
    );

    // 직전 scan이 끝난 지 2초 안이어도 변화 신호는 새로 훑게 한다. 읽기는 한 번도 부르지 않는다.
    const path = `${folder}/eval/experiments/exp-001-plan.md`;
    const text = await Deno.readTextFile(path);
    assert(text.includes("status: done"));
    await Deno.writeTextFile(
      path,
      text.replace("status: done", "status: paused"),
    );

    const raised = await until("the raised record", async () => {
      const count = await recordedCount(core);
      return count !== undefined && count > 7 ? count : undefined;
    }, 30_000);
    assertEquals(raised, 8);

    // 계약 경로 밖 파일은 신호를 만들지 않는다: 위반 수는 그대로다.
    await Deno.writeTextFile(`${folder}/outside.md`, "# nothing\n");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    assertEquals(await recordedCount(core), 8);
  });
});

// ── 감시 집합과 합침: fake 감시 source·fake timer ─────────────────────────

const CTX_A = "ctx_01arz3ndektsv4rrffq69g5faa";
const CTX_B = "ctx_01arz3ndektsv4rrffq69g5fab";
const flush = async () => {
  for (let turn = 0; turn < 8; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

function inputOf(
  context: string,
  paths: string[] | null,
  roots: string[] = ["/p"],
  hash = "a".repeat(64),
): ContextWorkInput {
  return {
    context,
    roots,
    recorded_count: 0,
    applied: paths === null ? null : {
      bundle_hash: hash,
      content: bundleContentSchema.parse({
        schema: 1,
        contract: contractOf([{ kind: "docs", paths }]),
      }),
    },
    candidate: null,
    user_saved_views: [],
    external_types: [],
    as_of_seq: "1",
    next_cursor: null,
    complete: true,
  } as unknown as ContextWorkInput;
}

function setup(
  inputs: Map<string, ContextWorkInput>,
  options: { missing?: Set<string> } = {},
) {
  const timer = fakeTimer();
  const watchFs = fakeWatchFs();
  const caught: string[] = [];
  const opened: string[] = [];
  let active = [...inputs.keys()];
  const reads: string[] = [];
  const watch = createContextsWatch({
    list: () =>
      Promise.resolve(ok({
        contexts: active.map((context) => {
          const input = inputs.get(context);
          return {
            context,
            roots: input?.roots ?? ["/p"],
            bundle_hash: input?.applied?.bundle_hash ?? "a".repeat(64),
          };
        }),
        checks: [],
        as_of_seq: "1",
        next_cursor: null,
      } as ContextWorkList)),
    readInput: ({ context }): Promise<Result<ContextWorkInput>> => {
      reads.push(context);
      const input = inputs.get(context);
      return Promise.resolve(
        input === undefined
          ? err({ code: "not_found", message: "no such context" })
          : ok(input),
      );
    },
    catchUp: (context) => {
      caught.push(context);
    },
    watchFs: (path, opts) => {
      if (options.missing?.has(path)) throw new Deno.errors.NotFound(path);
      opened.push(path);
      return watchFs(path, opts);
    },
    timer,
  });
  return {
    watch,
    timer,
    watchFs,
    caught,
    opened,
    reads,
    inputs,
    setActive: (next: string[]) => active = next,
  };
}

Deno.test("documents/contexts#R23 [ctx-T9d]: only the folders the active contracts point at are watched, under every Project folder, and each new context catches up once", async () => {
  const { watch, watchFs, caught } = setup(
    new Map([
      [CTX_A, inputOf(CTX_A, ["docs/*.md", "notes/**/*.md"], ["/p", "/q"])],
      [CTX_B, inputOf(CTX_B, ["plans/*.md"])],
    ]),
  );
  await watch.start();
  assertEquals(
    watchFs.watchers.map((w) => `${w.path}${w.recursive ? "/**" : ""}`).sort(),
    ["/p/docs", "/p/notes/**", "/p/plans", "/q/docs", "/q/notes/**"],
  );
  assertEquals(caught.sort(), [CTX_A, CTX_B]);
  assertEquals(
    [...watch.watching()].sort(),
    [[CTX_A, ["docs", "notes/**"]], [CTX_B, ["plans"]]],
  );
  watch.stop();
});

Deno.test("documents/contexts#R23 [ctx-T9d]: events inside one 500 ms window catch the context up once and events outside the contract do nothing", async () => {
  const { watch, timer, watchFs, caught } = setup(
    new Map([[CTX_A, inputOf(CTX_A, ["docs/*.md"])]]),
  );
  await watch.start();
  caught.length = 0;
  const [docs] = watchFs.watchers;
  docs!.emit({ kind: "modify", paths: ["/p/docs/a.md"] });
  docs!.emit({ kind: "create", paths: ["/p/docs/b.md"] });
  docs!.emit({ kind: "access", paths: ["/p/docs/c.md"] });
  // 폴더 바로 아래가 아닌 파일(recursive가 아니다)과 다른 폴더
  docs!.emit({ kind: "modify", paths: ["/p/docs/sub/d.md", "/p/other/e.md"] });
  await flush();
  timer.advance(499);
  assertEquals(caught, []);
  timer.advance(1);
  assertEquals(caught, [CTX_A]);

  docs!.emit({ kind: "modify", paths: ["/p/other/e.md"] });
  await flush();
  assertEquals(timer.pending(), 0);
  watch.stop();
});

Deno.test("documents/contexts#R23 [ctx-T9d]: an archived context stops being watched and its pending catch-up is dropped", async () => {
  const state = setup(new Map([[CTX_A, inputOf(CTX_A, ["docs/*.md"])]]));
  const { watch, timer, watchFs, caught, inputs } = state;
  await watch.start();
  caught.length = 0;
  watchFs.watchers[0]!.emit({ kind: "modify", paths: ["/p/docs/a.md"] });
  await flush();

  inputs.set(CTX_A, inputOf(CTX_A, null));
  watch.onCommand("context.archive", { context: CTX_A });
  await flush();
  assertEquals(watchFs.watchers.map((w) => w.closed), [true]);
  assertEquals([...watch.watching()], []);
  timer.advance(1_000);
  assertEquals(caught, []);

  // 보관을 풀면 다시 열고 한 번 따라잡는다.
  inputs.set(CTX_A, inputOf(CTX_A, ["docs/*.md"]));
  watch.onCommand("context.unarchive", { context: CTX_A });
  await flush();
  assertEquals(watchFs.watchers.map((w) => w.closed), [true, false]);
  assertEquals(caught, [CTX_A]);
  watch.stop();
});

Deno.test("documents/contexts#R23 [ctx-T9d]: a changed bundle reopens only that context's folders and a scan that sees the same input changes nothing", async () => {
  const state = setup(
    new Map([
      [CTX_A, inputOf(CTX_A, ["docs/*.md"])],
      [CTX_B, inputOf(CTX_B, ["plans/*.md"])],
    ]),
  );
  const { watch, watchFs, caught } = state;
  await watch.start();
  caught.length = 0;

  watch.observe(inputOf(CTX_A, ["docs/*.md"]));
  await flush();
  assertEquals(watchFs.watchers.length, 2);

  watch.observe(inputOf(CTX_A, ["specs/*.md"], ["/p"], "b".repeat(64)));
  await flush();
  assertEquals(
    watchFs.watchers.map((w) => [w.path, w.closed]),
    [["/p/docs", true], ["/p/plans", false], ["/p/specs", false]],
  );
  // scan이 입력을 알린 것이라 따라잡기를 다시 부르지 않는다.
  assertEquals(caught, []);
  watch.stop();
});

Deno.test("documents/contexts#R23 [ctx-T9d]: a folder that does not exist yet is skipped and opened at the next refresh", async () => {
  const missing = new Set(["/p/docs"]);
  const { watch, watchFs, caught, opened } = setup(
    new Map([[CTX_A, inputOf(CTX_A, ["docs/*.md", "plans/*.md"])]]),
    { missing },
  );
  await watch.start();
  assertEquals(opened, ["/p/plans"]);
  assertEquals(caught, [CTX_A]);

  // 폴더가 생겼다. 같은 입력이어도 다시 정하기가 빠진 폴더를 연다.
  missing.clear();
  await watch.refresh(CTX_A);
  assertEquals(opened, ["/p/plans", "/p/docs", "/p/plans"]);
  assertEquals(caught, [CTX_A, CTX_A]);
  assertEquals(
    watchFs.watchers.map((w) => [w.path, w.closed]),
    [["/p/plans", true], ["/p/docs", false], ["/p/plans", false]],
  );

  // 이제 다 열렸으니 같은 입력은 아무것도 다시 열지 않는다.
  await watch.refresh(CTX_A);
  assertEquals(watchFs.watchers.length, 3);
  watch.stop();
});

Deno.test("documents/contexts#R23 [ctx-T9d]: a project command re-reads the active set and drops contexts that left it", async () => {
  const state = setup(
    new Map([
      [CTX_A, inputOf(CTX_A, ["docs/*.md"])],
      [CTX_B, inputOf(CTX_B, ["plans/*.md"])],
    ]),
  );
  const { watch, watchFs } = state;
  await watch.start();
  assertEquals(state.reads.sort(), [CTX_A, CTX_B]);

  state.setActive([CTX_A]);
  watch.onCommand("project.archive", { project: "prj_x" });
  await flush();
  assertEquals(
    watchFs.watchers.map((w) => [w.path, w.closed]),
    [["/p/docs", false], ["/p/plans", true]],
  );
  // the list already says the remaining context's folders and bundle are the same: its contract is not read again
  assertEquals(state.reads.length, 2);

  // 관계없는 command는 아무것도 읽지 않는다.
  watch.onCommand("document.create", {});
  watch.onCommand("context.archive", {});
  await flush();
  assertEquals(watchFs.watchers.length, 2);
  watch.stop();
});

Deno.test("documents/contexts#R23 [ctx-T9d]: stopping closes every watcher and later events catch nothing up", async () => {
  const { watch, timer, watchFs, caught } = setup(
    new Map([[CTX_A, inputOf(CTX_A, ["docs/*.md"])]]),
  );
  await watch.start();
  caught.length = 0;
  watchFs.watchers[0]!.emit({ kind: "modify", paths: ["/p/docs/a.md"] });
  await flush();
  watch.stop();
  assertEquals(watchFs.watchers.map((w) => w.closed), [true]);
  timer.advance(1_000);
  assertEquals(caught, []);
  assertEquals(timer.pending(), 0);
  // 멈춘 뒤의 알림은 감시를 다시 열지 않는다.
  watch.observe(inputOf(CTX_A, ["docs/*.md"]));
  await flush();
  assertEquals(watchFs.watchers.length, 1);
});

Deno.test("documents/contexts#R23 [ctx-I67]: the watch asks for the list, reads a contract only when its context's folders or bundle changed, and a context without folders is not watched", async () => {
  const state = setup(
    new Map([
      [CTX_A, inputOf(CTX_A, ["docs/*.md"])],
      [CTX_B, inputOf(CTX_B, ["plans/*.md"], [])],
    ]),
  );
  await state.watch.start();
  assertEquals(state.reads, [CTX_A]);
  assertEquals([...state.watch.watching().keys()], [CTX_A]);

  // a project command with the same list reads nothing
  state.watch.onCommand("project.update", { project: "prj_x" });
  await flush();
  assertEquals(state.reads, [CTX_A]);

  // another folder or another bundle reads that context again
  state.inputs.set(CTX_A, inputOf(CTX_A, ["docs/*.md"], ["/p", "/q"]));
  state.watch.onCommand("project.update", { project: "prj_x" });
  await flush();
  assertEquals(state.reads, [CTX_A, CTX_A]);
  assertEquals(
    state.watchFs.watchers.filter((w) => !w.closed).map((w) => w.path).sort(),
    ["/p/docs", "/q/docs"],
  );
  state.watch.stop();
});
