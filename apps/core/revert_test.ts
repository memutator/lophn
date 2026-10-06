// lophn-agent/revert를 실제 core와 documents worker, I/O worker에서 본다(모두 실제 자식 프로세스이고
// 데이터 root는 temp dir다. 사람 데이터 root는 열지 않는다). model provider는 부르지 않는다.
// 문서 변경은 run에 묶인 agent 자격의 문서 tool이 실제 저장 통로로 만들고, revert는 사람 자격으로
// preview·확인 handle·RevertRun을 같은 core의 HTTP route로 부른다. 복원은 documents가 선언한
// dispatchable command(`document.archive`, `document.restore`)가 한다. 순수 규칙과 owner 판정은
// packages/lophn-agent/revert/revert_test.ts, 전체 사전 검사와 원자 적용은
// apps/core/testing/lophn-agent-revert_test.ts가 본다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { manualClock, ok, seededRandom } from "../../packages/base/mod.ts";
import type { Result } from "../../packages/base/mod.ts";
import { ROUTES as DOCUMENT_ROUTES } from "../../packages/contracts/documents/mod.ts";
import {
  revertRun,
  ROUTES as AGENT_ROUTES,
} from "../../packages/contracts/lophn-agent/mod.ts";
import type {
  AuthenticatedContext,
  JsonObject,
} from "../../packages/contracts/platform/mod.ts";
import { createCoreClient } from "../../packages/coding-agent/connection/client/core.ts";
import {
  saveFromPaths,
  uploadPrepareBytes,
} from "../../packages/coding-agent/connection/mod.ts";
import {
  BUILTIN_TOOLS,
  createBuiltinToolHandlers,
  executeTool,
  listTools,
  type RunCredential,
  runOperations,
} from "../../packages/lophn-agent/harness/tools/mod.ts";
import { confirmationBinding } from "../../packages/platform/identity/mod.ts";
import {
  buildRevertInput,
  REVERT_REASONS,
  type RevertGroup,
} from "../../packages/lophn-agent/revert/mod.ts";
import { type Core, startCore } from "./core.ts";
import { lophnAgentDefinitions } from "./lophn-agent.ts";
import { createLedgerRegistration as documentsRegistration } from "./documents.ts";
import type { TeamModule } from "./registration.ts";
import {
  call,
  command,
  count,
  inspect,
  type Reply,
  type Server,
} from "./testing/approvals-fixture.ts";

const teams: TeamModule[] = [
  { lophnAgentDefinitions },
  { createLedgerRegistration: documentsRegistration },
];

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const PROJECT = id("prj", 1);
const PLACE = { kind: "project" as const, id: PROJECT };
const MACHINE_TOKEN = "m".repeat(43);
const USER_TOKEN = "u".repeat(43);
const SEED_TOKEN = "s".repeat(43);
const AGENT_TOKEN = "x".repeat(43);
const RUN_A = id("run", 1);
const MSG_ONE = id("msg", 1);
const BASIS = "b".repeat(64);
const FINAL = "d".repeat(64);
const LIMITS = { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 };

const AGENT_OPERATIONS = [
  ...runOperations(BUILTIN_TOOLS),
  "document.file",
  "document.get",
  "PreviewRevert",
  "RevertRun",
];

const USER_OPERATIONS = [
  "project.create",
  "document.archive",
  "document.restore",
  "document.prepare",
  "document.file",
  "document.get",
  "document.history",
  "PreviewRevert",
  "ListReverts",
  "RevertRun",
];

type World = {
  core: Core;
  server: Server;
  home: string;
  work: string;
  assignment: Assignment;
  seed: ReturnType<typeof seeder>;
  tools(): { run: ReturnType<typeof makeRunner> };
  dispose(): Promise<void>;
};

type Assignment = { id: string; role: string; revision: number };

async function accept(
  core: Core,
  credential: AuthenticatedContext,
  token: string,
) {
  const accepted = await core.acceptTestCredential?.(credential, token);
  assert(accepted?.ok);
  const recorded = await core.record(credential);
  assert(recorded.ok);
}

function seeder(core: Core, work: string, home: string) {
  const client = createCoreClient({
    baseUrl: `http://127.0.0.1:${core.port}`,
    connection: CAC,
    provider: () => Promise.resolve({ ok: true, value: { token: SEED_TOKEN } }),
  });
  const deps = {
    client,
    scope: { root: work, forbidden: [home] },
    prepareBytes: uploadPrepareBytes(client),
  };
  let n = 0;
  return async (
    place: typeof PLACE | null,
    slug: string | null,
    text: string,
    title = "문서",
  ) => {
    n += 1;
    const path = `seed-${n}.md`;
    await Deno.writeTextFile(`${work}/${path}`, text);
    const saved = await saveFromPaths(deps, {
      paths: [path],
      ...(place === null ? {} : { place, slug }),
      title,
    });
    assert(saved.ok, saved.ok ? "" : JSON.stringify(saved.error));
    return {
      document: saved.value.saved.document,
      version: saved.value.saved.version,
    };
  };
}

function makeRunner(
  listed: ReturnType<typeof listTools>,
  handlers: ReturnType<typeof createBuiltinToolHandlers>,
) {
  return (tool: string, input: unknown, call?: string) => {
    const credential: RunCredential = {
      run: RUN_A,
      targets: new Set(),
      operations: new Set(AGENT_OPERATIONS),
      ...(call === undefined ? {} : { call }),
    };
    return executeTool({ listed, handlers, credential }, tool, input);
  };
}

async function open(): Promise<World> {
  const home = await Deno.makeTempDir({ prefix: "lophn-revert-" });
  const work = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-revert-work-" }),
  );
  const clock = manualClock(Date.UTC(2024, 0, 1));
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams,
    teamModules: [
      new URL("./lophn-agent.ts", import.meta.url).href,
      new URL("./documents.ts", import.meta.url).href,
    ],
    clock,
    random: seededRandom(29),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  const server: Server = {
    port: core.port,
    dataRoot: core.dataRoot,
    clock,
    confirmation: (body) =>
      core.confirmation?.(body) ??
        Promise.resolve({ ok: false as const, error: { message: "없다" } }),
  };
  await accept(core, {
    principal: "machine",
    actor: "machine",
    scope: {
      operations: [
        "ListAssignments",
        "AcceptRun",
        "StartRun",
        "FinishRun",
        "ReadRun",
      ],
      targets: {},
    },
    conditions: {},
    credential_ref: "cred-machine",
  }, MACHINE_TOKEN);
  await accept(core, {
    principal: "user",
    actor: "user",
    scope: { operations: USER_OPERATIONS, targets: {} },
    conditions: {},
    credential_ref: "cred-user",
  }, USER_TOKEN);
  await accept(core, {
    principal: `coding_agent:${CAC}`,
    actor: `coding_agent:${CAC}`,
    scope: {
      operations: [
        "document.upload",
        "document.prepare",
        "document.save",
        "document.list",
        "document.get",
        "document.history",
      ],
      targets: {},
    },
    conditions: {},
    credential_ref: "cred-seed",
  }, SEED_TOKEN);
  const listed = await call(server, "assignments/list", MACHINE_TOKEN, {});
  assertEquals(listed.status, 200, JSON.stringify(listed.body));
  const assignment = (listed.body["assignments"] as Assignment[]).find((
    entry,
  ) => entry.role === "lophn");
  assert(assignment !== undefined);
  const accepted = await call(
    server,
    "runs/accept",
    MACHINE_TOKEN,
    command({
      id: RUN_A,
      assignment: assignment.id,
      session: null,
      source: { kind: "message", message: MSG_ONE },
      continued_from: null,
      start_after: null,
    }, { compare: { assignment_revision: assignment.revision } }),
  );
  assertEquals(accepted.status, 200, JSON.stringify(accepted.body));
  await accept(core, {
    principal: `agent:${assignment.id}`,
    actor: `agent:${assignment.id}`,
    scope: {
      operations: AGENT_OPERATIONS,
      targets: { assignment: assignment.id, run: RUN_A },
    },
    conditions: { assignment: assignment.id, run: RUN_A },
    credential_ref: `cred-agent-${RUN_A}`,
  } as AuthenticatedContext, AGENT_TOKEN);
  const created = await call(
    server,
    "projects/create",
    USER_TOKEN,
    command({
      id: PROJECT,
      name: "alpha",
      title: "alpha",
      purpose: "",
      folders: [{ path: `${work}/alpha-folder`, description: "" }],
      tracking: { enabled: false, patterns: [], use_gitignore: false },
    }),
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
  const routes = new Map<string, { resource: string; method: string }>(
    [...DOCUMENT_ROUTES, ...AGENT_ROUTES].map((route) => [route.name, route]),
  );
  const ports = {
    call: async (
      contract: string,
      input: unknown,
    ): Promise<Result<unknown>> => {
      const route = routes.get(contract);
      assert(route !== undefined, contract);
      const reply = await call(
        server,
        `${route.resource}/${route.method}`,
        AGENT_TOKEN,
        input,
      );
      if (reply.status === 200) return ok(reply.body);
      const error = reply.body["error"] as { code?: string } | undefined;
      return {
        ok: false as const,
        error: {
          code: (error?.code ?? "internal") as "internal",
          message: "core refused",
        },
      };
    },
    newId: (prefix: "qst" | "run") => id(prefix, 40),
    runFacts: () =>
      Promise.resolve(ok({
        session: null,
        role: "lophn" as const,
        original_message: MSG_ONE,
      })),
  };
  const names = BUILTIN_TOOLS.map((tool) => tool.name);
  const listedTools = listTools(
    { builtin: BUILTIN_TOOLS, app: [], external: [] },
    { presetTools: names, roleTools: names },
  );
  const runner = makeRunner(listedTools, createBuiltinToolHandlers(ports));
  return {
    core,
    server,
    home,
    work,
    assignment,
    seed: seeder(core, work, home),
    tools: () => ({ run: runner }),
    async dispose() {
      await core.shutdown();
      await Deno.remove(home, { recursive: true });
      await Deno.remove(work, { recursive: true });
    },
  };
}

function contentOf(outcome: { result: { content: unknown } }) {
  return outcome.result.content as Record<string, unknown>;
}

// 본문 읽기는 파생 자료(section 추출)가 준비된 뒤에 나온다. 본문이 올 때까지 기다린다.
async function readWhole(
  run: (tool: string, input: unknown) => ReturnType<typeof executeTool>,
  document: string,
  version: string,
) {
  let last = await run("document.read_version", {
    reference: { document, version, section: null },
  });
  for (let tries = 0; tries < 120; tries += 1) {
    if (
      contentOf(last)["text"] !== null && contentOf(last)["text"] !== undefined
    ) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    last = await run("document.read_version", {
      reference: { document, version, section: null },
    });
  }
  throw new Error(`no text: ${JSON.stringify(last.result)}`);
}

const PLAN = "# 계획\n\n## 목표\n\n첫째 줄\n\n## 범위\n\n셋째 줄\n";
const EDITED = PLAN + "\n에이전트가 더했다\n";

async function readRun(world: World, run: string) {
  const reply = await call(world.server, "runs/read", MACHINE_TOKEN, { run });
  assertEquals(reply.status, 200, JSON.stringify(reply.body));
  return reply.body["run"] as { state: string; state_seq: string };
}

async function startRun(world: World) {
  const record = await readRun(world, RUN_A);
  const started = await call(
    world.server,
    "runs/start",
    MACHINE_TOKEN,
    command({
      run: RUN_A,
      basis: BASIS,
      limits: LIMITS,
      scope: { role: "lophn", assignment: world.assignment.id, apps: [] },
    }, { compare: { state_seq: record.state_seq } }),
  );
  assertEquals(started.status, 200, JSON.stringify(started.body));
}

async function finishRun(world: World) {
  const record = await readRun(world, RUN_A);
  const finished = await call(
    world.server,
    "runs/finish",
    MACHINE_TOKEN,
    command({
      run: RUN_A,
      outcome: { kind: "completed", reason: "answer_completed" },
      result: FINAL,
    }, { compare: { state_seq: record.state_seq } }),
  );
  assertEquals(finished.status, 200, JSON.stringify(finished.body));
}

type Preview = {
  run: string;
  groups: RevertGroup[];
  binding_hash: string;
};

async function preview(world: World, token = USER_TOKEN): Promise<Reply> {
  return await call(world.server, "reverts/preview", token, { run: RUN_A });
}

async function previewOf(world: World): Promise<Preview> {
  const reply = await preview(world);
  assertEquals(reply.status, 200, JSON.stringify(reply.body));
  return reply.body as unknown as Preview;
}

// run이 한 일: 이미 있던 문서 하나를 고치고 문서 하나를 새로 만든다. 사람이 본 판은 run이 끝난
// 뒤의 것이다.
async function agentWork(world: World) {
  const base = await world.seed(PLACE, "plan", PLAN, "계획");
  await startRun(world);
  const run = world.tools().run;
  await readWhole(run, base.document, base.version);
  const saved = await run("document.save_version", {
    document: base.document,
    base_version: base.version,
    text: EDITED,
    media_type: "text/markdown",
  }, id("tcl", 1));
  assertEquals(saved.outcome.kind, "success", JSON.stringify(saved));
  const edited = contentOf(saved)["version"] as string;
  const made = await run("document.create", {
    title: "메모",
    place: PLACE,
    name: "memo",
    text: "# 메모\n\n새 문서\n",
    media_type: "text/markdown",
  }, id("tcl", 2));
  assertEquals(made.outcome.kind, "success", JSON.stringify(made));
  const created = contentOf(made)["document"] as string;
  await finishRun(world);
  return { base, edited, created };
}

type Fixed = {
  document: { revision: string; latest_version: string; status: string };
  version: {
    id: string;
    format: unknown;
    files: {
      path: string;
      blob_hash: string;
      bytes: number;
      media_type: string;
      primary: boolean;
    }[];
  };
};

async function fixedOf(
  world: World,
  document: string,
  version?: string,
): Promise<Fixed> {
  const reply = await call(
    world.server,
    "documents/get",
    USER_TOKEN,
    version === undefined ? { document } : { document, version },
  );
  assertEquals(reply.status, 200, JSON.stringify(reply.body));
  return reply.body as unknown as Fixed;
}

// 사람이 옛 판의 원문 blob 참조로 복원을 준비한다(document.prepare). 형식은 그 판의 정확한
// FormatRef다. 준비 결과가 RevertRun 입력의 그 묶음에 실린다.
async function prepareRestore(
  world: World,
  group: RevertGroup,
  key: string,
): Promise<Result<JsonObject | null>> {
  const comparison = group.comparison as Record<string, string> | null;
  if (comparison === null || comparison["kind"] !== "restore") return ok(null);
  const fixed = await fixedOf(
    world,
    comparison["document"],
    comparison["restore_version"],
  );
  const reply = await call(world.server, "documents/prepare", USER_TOKEN, {
    document: comparison["document"],
    base_version: comparison["base_version"],
    files: fixed.version.files.map((file) => ({
      ...file,
      content: {
        kind: "existing",
        reference: {
          owner_kind: "document_version",
          owner_key: `${fixed.version.id}/${file.path}`,
          field: "file",
          hash: file.blob_hash,
          registered_seq: "1",
        },
      },
    })),
    format: fixed.version.format,
    source: null,
    idempotency_key: key,
  });
  assertEquals(reply.status, 200, JSON.stringify(reply.body));
  return ok(reply.body as JsonObject);
}

async function applyInput(world: World, shown: Preview, key: string) {
  const items = await buildRevertInput(
    shown.groups,
    (group) => prepareRestore(world, group, `${key}-${group.ordinal}`),
  );
  assert(items.ok);
  return items.value;
}

async function handleFor(
  world: World,
  input: Record<string, unknown>,
): Promise<string> {
  const binding = await confirmationBinding(revertRun, input);
  assert(binding !== undefined);
  const issued = await world.server.confirmation({
    action: "issue",
    request: {
      type: "confirmation_handle_register",
      window_id: `win-${String(input["id"])}-${crypto.randomUUID()}`,
      target_ref: binding.target,
      content_hash: binding.content,
      // 확인 handle의 결정 이름은 적용하는 command 이름이다(platform/identity).
      allowed_decisions: [revertRun.name],
      expires_at: new Date(Date.UTC(2024, 0, 1) + 600_000).toISOString(),
    },
  });
  assert(issued.ok, issued.ok ? "" : issued.error.message);
  return (issued.value as { confirmation: string }).confirmation;
}

async function revert(
  world: World,
  shown: Preview,
  options: {
    id?: string;
    allowPartial?: boolean;
    token?: string;
    key?: string;
    confirmed?: boolean;
  } = {},
): Promise<Reply> {
  const revertId = options.id ?? id("rvt", 1);
  const groups = await applyInput(world, shown, options.key ?? "prep");
  const input = {
    id: revertId,
    run: RUN_A,
    allow_partial: options.allowPartial ?? false,
    preview_hash: shown.binding_hash,
    groups,
  };
  const confirmation = options.confirmed === false
    ? undefined
    : await handleFor(world, input);
  const prepared = groups
    .map((group) =>
      group.comparison["prepared"] as { preparation_ref?: string }
    )
    .filter((item) => item !== undefined)
    .map((item) => item.preparation_ref as string);
  return await call(
    world.server,
    "reverts/apply",
    options.token ?? USER_TOKEN,
    {
      ...command(input, {
        compare: { preview_hash: shown.binding_hash },
        ...(confirmation === undefined ? {} : { confirmation }),
      }),
      // agent 자격의 요청은 자기 run을 싣는다. 그래도 revert는 사람만 요청한다.
      ...(options.token === AGENT_TOKEN ? { run: RUN_A } : {}),
      prepared,
    },
  );
}

function versionsOf(world: World, document: string): number {
  return count(
    world.server,
    "select count(*) as n from versions where document = ?",
    [document],
  );
}

function runEventCount(world: World): number {
  return count(
    world.server,
    "select count(*) as n from events where run = ?",
    [RUN_A],
  );
}

function groupOf(shown: Preview, document: string, kind: string) {
  return shown.groups.find((group) =>
    group.target === document &&
    (group.comparison as Record<string, unknown> | null)?.["kind"] === kind
  );
}

Deno.test("lophn-agent/revert#R3: 끝난 run의 문서 변경은 복원 가능으로, run의 사실은 유지로 분류해 빠짐없이 보여 준다", async () => {
  const world = await open();
  try {
    const work = await agentWork(world);
    const shown = await previewOf(world);
    const archive = groupOf(shown, work.created, "archive");
    const restore = groupOf(shown, work.base.document, "restore");
    assert(archive !== undefined && restore !== undefined);
    assertEquals(archive.capability, "reversible");
    assertEquals(archive.owner, "documents/versions");
    assertEquals(restore.capability, "reversible");
    assertEquals(
      (restore.comparison as Record<string, string>)["restore_version"],
      work.base.version,
    );
    assertEquals(
      (restore.comparison as Record<string, string>)["base_version"],
      work.edited,
    );
    // run의 event 전체가 한 묶음에만 속한다.
    const covered = shown.groups.flatMap((group) => group.source_seqs);
    assertEquals(new Set(covered).size, covered.length);
    const events = inspect(
      world.server,
      "select cast(seq as text) as seq from events where run = ? order by seq",
      [RUN_A],
    ).map((row) => String(row["seq"]));
    assertEquals(covered.slice().sort((a, b) => Number(a) - Number(b)), events);
    // 복원할 수 없는 업무 변경은 없고, 나머지는 모두 유지하는 사실이다.
    for (const group of shown.groups) {
      if (group === archive || group === restore) continue;
      assertEquals(group.capability, "retained", JSON.stringify(group));
      assertEquals(group.reason_blob, REVERT_REASONS.audit_fact);
    }
    // 읽기는 command도 event도 만들지 않는다.
    assertEquals(runEventCount(world), events.length);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/revert#R5: 복원은 만든 문서를 보관하고 고친 문서는 이전 내용의 새 version으로 남기며 원래 판과 event는 그대로다", async () => {
  const world = await open();
  try {
    const work = await agentWork(world);
    const shown = await previewOf(world);
    const eventsBefore = runEventCount(world);
    const head = count(world.server, "select max(seq) as n from events");
    assertEquals(versionsOf(world, work.base.document), 2);
    const reply = await revert(world, shown);
    assertEquals(reply.status, 200, JSON.stringify(reply.body));
    assertEquals(reply.body["outcome"], "applied");
    assertEquals(reply.body["replayed"], false);
    // 만든 문서는 보관됐다. 판은 지워지지 않는다.
    const archived = await fixedOf(world, work.created);
    assertEquals(archived.document.status, "archived");
    assertEquals(versionsOf(world, work.created), 1);
    // 고친 문서는 새 최신 판이 처음 내용이고 이전 판은 모두 남는다.
    assertEquals(versionsOf(world, work.base.document), 3);
    const latest = await fixedOf(world, work.base.document);
    assertNotEquals(latest.document.latest_version, work.edited);
    assertNotEquals(latest.document.latest_version, work.base.version);
    const first = await fixedOf(world, work.base.document, work.base.version);
    const now = await fixedOf(
      world,
      work.base.document,
      latest.document.latest_version,
    );
    assertEquals(
      now.version.files.map((file) => file.blob_hash),
      first.version.files.map((file) => file.blob_hash),
    );
    // run의 원래 event는 하나도 바뀌지 않았고 복원 event는 사람(user)의 새 event다.
    assertEquals(runEventCount(world), eventsBefore);
    const added = inspect(
      world.server,
      "select type, actor, run from events where seq > ? order by seq",
      [head],
    );
    assert(added.length >= 3);
    for (const event of added) {
      assertEquals(event["actor"], "user");
      assertEquals(event["run"], null);
    }
    const types = added.map((event) => event["type"]);
    assert(types.includes("DocumentArchived"));
    assert(types.includes("DocumentRestored"));
    assertEquals(types[types.length - 1], "RevertApplied");
    // 복원 결과는 목록으로 읽힌다: 복원한 묶음은 보상 event와 이어지고 유지 묶음은 그대로다.
    const listed = await call(world.server, "reverts/list", USER_TOKEN, {
      run: RUN_A,
    });
    assertEquals(listed.status, 200, JSON.stringify(listed.body));
    const record = (listed.body["reverts"] as {
      id: string;
      outcome: string;
      changes: {
        capability: string;
        result: string;
        restored_seqs: string[];
        source_seqs: string[];
      }[];
    }[])[0];
    assertEquals(record.outcome, "applied");
    const restored = record.changes.filter((change) =>
      change.result === "restored"
    );
    assertEquals(restored.length, 2);
    assert(restored.every((change) => change.restored_seqs.length > 0));
    assert(
      record.changes.filter((change) => change.capability === "retained")
        .every((change) =>
          change.result === "retained" && change.restored_seqs.length === 0
        ),
    );
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/revert#R8: 같은 revert 요청을 반복해도 복원은 한 번만 적용되고 같은 run의 다른 시도는 거절된다", async () => {
  const world = await open();
  try {
    const work = await agentWork(world);
    const shown = await previewOf(world);
    const first = await revert(world, shown);
    assertEquals(first.status, 200, JSON.stringify(first.body));
    const versions = versionsOf(world, work.base.document);
    const events = count(world.server, "select count(*) as n from events");
    // 같은 id의 다른 요청(다른 idempotency key와 확인 handle)은 저장된 결과를 돌려준다.
    const again = await revert(world, shown, { key: "prep-again" });
    assertEquals(again.status, 200, JSON.stringify(again.body));
    assertEquals(again.body["replayed"], true);
    assertEquals(again.body["outcome"], "applied");
    assertEquals(again.body["result_seq"], first.body["result_seq"]);
    assertEquals(versionsOf(world, work.base.document), versions);
    assertEquals(
      count(world.server, "select count(*) as n from events"),
      events,
    );
    assertEquals(
      count(world.server, "select count(*) as n from reverts"),
      1,
    );
    // 이미 복원한 run에 다른 id로 다시 요청하면 conflict다. 두 번째 복원은 일어나지 않는다.
    const other = await revert(world, shown, {
      id: id("rvt", 2),
      key: "prep-other",
    });
    assertEquals(other.status, 409, JSON.stringify(other.body));
    assertEquals(versionsOf(world, work.base.document), versions);
    // 원래 run의 변경 기록은 그대로 읽힌다.
    const history = await call(world.server, "documents/history", USER_TOKEN, {
      document: work.base.document,
    });
    assertEquals(history.status, 200, JSON.stringify(history.body));
    const saved = (history.body["versions"] as { id: string }[]).map((item) =>
      item.id
    );
    assert(saved.includes(work.edited));
    assert(saved.includes(work.base.version));
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/revert#R4: run 뒤에 다른 변경이 있으면 어느 문서도 복원하지 않고 blocked 결과를 남긴다", async () => {
  const world = await open();
  try {
    const work = await agentWork(world);
    // 사람이 고친 것처럼 run이 끝난 뒤 같은 문서에 새 판이 저장됐다.
    await world.seed(PLACE, "plan", PLAN + "\n나중에 고쳤다\n", "계획");
    const shown = await previewOf(world);
    const conflicted = groupOf(shown, work.base.document, "document") ??
      shown.groups.find((group) => group.target === work.base.document);
    assert(conflicted !== undefined);
    assertEquals(conflicted.capability, "conflict");
    assertEquals(conflicted.reason_blob, REVERT_REASONS.later_change);
    // 만든 문서는 복원할 수 있지만 전체가 막힌다.
    assertEquals(
      groupOf(shown, work.created, "archive")?.capability,
      "reversible",
    );
    const versions = versionsOf(world, work.base.document);
    const reply = await revert(world, shown);
    assertEquals(reply.status, 200, JSON.stringify(reply.body));
    assertEquals(reply.body["outcome"], "blocked");
    assertEquals(
      (await fixedOf(world, work.created)).document.status,
      "active",
    );
    assertEquals(versionsOf(world, work.base.document), versions);
    const events = inspect(
      world.server,
      "select type from events where type like 'Revert%' or type like 'DocumentArchived'",
    ).map((row) => row["type"]);
    assertEquals(events, ["RevertBlocked"]);
    const listed = await call(world.server, "reverts/list", USER_TOKEN, {
      run: RUN_A,
    });
    const record = (listed.body["reverts"] as {
      outcome: string;
      changes: { capability: string; result: string }[];
    }[])[0];
    assertEquals(record.outcome, "blocked");
    assert(
      record.changes.filter((change) => change.capability === "reversible")
        .every((change) => change.result === "unchanged"),
    );
    // blocked 뒤 새 시도는 새 ID이고, 이번엔 현재 판이 달라졌다(기준이 바뀌지 않으면 같은 이유로 막힌다).
    const retried = await revert(world, await previewOf(world), {
      id: id("rvt", 3),
      key: "prep-retry",
    });
    assertEquals(retried.body["outcome"], "blocked");
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/revert#R2: agent는 revert를 요청할 수 없고 확인 handle 없는 요청도 거절되며 사람 적용 뒤 새 run은 생기지 않는다", async () => {
  const world = await open();
  try {
    await agentWork(world);
    const shown = await previewOf(world);
    const runs = count(world.server, "select count(*) as n from runs");
    const asAgent = await revert(world, shown, { token: AGENT_TOKEN });
    assertEquals(asAgent.status, 403, JSON.stringify(asAgent.body));
    const unconfirmed = await revert(world, shown, { confirmed: false });
    // 확인 handle은 이 command가 선언한 필수 field라서 없으면 요청 형식부터 거절된다.
    assertEquals(unconfirmed.status, 400, JSON.stringify(unconfirmed.body));
    assertEquals(
      count(world.server, "select count(*) as n from reverts"),
      0,
    );
    const done = await revert(world, shown);
    assertEquals(done.body["outcome"], "applied");
    assertEquals(count(world.server, "select count(*) as n from runs"), runs);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/revert#R1: 끝나지 않은 run은 미리보기도 적용도 못 하고 agent는 자기 run의 미리보기만 읽는다", async () => {
  const world = await open();
  try {
    const work = await world.seed(PLACE, "plan", PLAN, "계획");
    await startRun(world);
    const unfinished = await preview(world);
    assertEquals(unfinished.status, 400, JSON.stringify(unfinished.body));
    // 확인한 요청도 끝나지 않은 run이면 conflict다. 먼저 멈춰 실제 종료를 확인해야 한다.
    const input = {
      id: id("rvt", 1),
      run: RUN_A,
      allow_partial: false,
      preview_hash: "a".repeat(64),
      groups: [{ source_seqs: ["1"], comparison: {}, prepared_ref: null }],
    };
    const attempted = await call(
      world.server,
      "reverts/apply",
      USER_TOKEN,
      command(input, {
        compare: { preview_hash: input.preview_hash },
        confirmation: await handleFor(world, input),
      }),
    );
    assertEquals(attempted.status, 409, JSON.stringify(attempted.body));
    assertEquals(count(world.server, "select count(*) as n from reverts"), 0);
    void work;
    await finishRun(world);
    // 끝난 뒤에는 그 run의 agent 자격이 자기 run의 미리보기를 읽고, 없는 run과 같은 답은 범위 밖이다.
    const own = await preview(world, AGENT_TOKEN);
    assertEquals(own.status, 200, JSON.stringify(own.body));
    const absent = await call(world.server, "reverts/preview", AGENT_TOKEN, {
      run: id("run", 9),
    });
    assertEquals(absent.status, 404);
  } finally {
    await world.dispose();
  }
});
