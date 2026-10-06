// roles/context-engineer#R4·R5와 lophn-agent/revert#R3·R4·R5를 실제 core와 documents worker, I/O worker에서
// 본다(모두 실제 자식 프로세스이고 데이터 root는 temp dir다. 사람 데이터 root는 열지 않는다). model
// provider는 부르지 않는다. context·용어 변경은 run에 묶인 Context Engineer agent 자격의 tool이 실제
// documents command로 만들고, revert는 사람 자격으로 preview·확인 handle·RevertRun을 같은 core의
// HTTP route로 부른다. 복원은 documents가 dispatchable로 선언한 context·term command가 한다. 순수
// 분류와 보상 열은 packages/lophn-agent/revert/context_revert_test.ts, tool 정의와 handler는
// packages/lophn-agent/harness/tools/context_tools_test.ts가 본다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, ok, seededRandom } from "../../packages/base/mod.ts";
import type { Result } from "../../packages/base/mod.ts";
import { ROUTES as DOCUMENT_ROUTES } from "../../packages/contracts/documents/mod.ts";
import {
  revertRun,
  ROUTES as AGENT_ROUTES,
} from "../../packages/contracts/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
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
const OTHER_AGENT_TOKEN = "y".repeat(43);
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
  "ListReverts",
  "ListEvents",
  "RevertStarted",
  "RevertApplied",
  "RevertBlocked",
  "RevertFinished",
];

const USER_OPERATIONS = [
  "project.create",
  "context.create",
  "context.update",
  "context.set_item",
  "context.remove_item",
  "context.archive",
  "context.unarchive",
  "context.get",
  "context.list",
  "term.propose",
  "term.define",
  "term.update",
  "term.archive",
  "term.unarchive",
  "term.get",
  "term.list",
  "document.archive",
  "document.restore",
  "document.prepare",
  "document.file",
  "document.get",
  "document.history",
  "PreviewRevert",
  "ListReverts",
  "RevertRun",
  "ListEvents",
  "RevertStarted",
  "RevertApplied",
  "RevertBlocked",
  "RevertFinished",
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
  ) => entry.role === "context_engineer");
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
  const editor = (listed.body["assignments"] as Assignment[]).find((entry) =>
    entry.role === "lophn"
  );
  assert(editor !== undefined);
  // 다른 assignment의 agent 자격이다. 이 run의 revert event를 보지 못해야 한다.
  await accept(core, {
    principal: `agent:${editor.id}`,
    actor: `agent:${editor.id}`,
    scope: { operations: AGENT_OPERATIONS, targets: { assignment: editor.id } },
    conditions: { assignment: editor.id },
    credential_ref: "cred-agent-other",
  } as AuthenticatedContext, OTHER_AGENT_TOKEN);
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
  const routes = new Map<
    string,
    { resource: string; method: string; kind: string }
  >([...DOCUMENT_ROUTES, ...AGENT_ROUTES].map((route) => [route.name, route]));
  const ports = {
    // command는 tool이 정한 비교 기준과 idempotency key를 요청 봉투에 싣고 run은 호출 run이다.
    // 읽기와 worker route는 입력 그대로 보낸다.
    call: async (
      contract: string,
      input: unknown,
      run: string,
      options?: { compare?: unknown; idempotency_key?: string },
    ): Promise<Result<unknown>> => {
      const route = routes.get(contract);
      assert(route !== undefined, contract);
      const reply = await call(
        server,
        `${route.resource}/${route.method}`,
        AGENT_TOKEN,
        route.kind === "command"
          ? {
            ...command(input, { compare: options?.compare ?? {} }),
            idempotency_key: options?.idempotency_key ??
              `idem-${crypto.randomUUID()}`,
            run,
          }
          : input,
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
        role: "context_engineer" as const,
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
      scope: {
        role: "context_engineer",
        assignment: world.assignment.id,
        apps: [],
      },
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

const SOURCE = [
  "# 용어",
  "",
  "## 요약",
  "",
  "범위는 이번 판단의 대상이다.",
  "",
  "## 부록",
  "",
  "경계는 여기 적지 않는다.",
  "",
].join("\n");

const CTX_OLD = id("ctx", 1);
const TRM_DEFINED = id("trm", 1);
const TRM_USER = id("trm", 2);

// 사람의 요청이다. 사람 자격으로 owner command를 부른다(run 밖의 변경).
function asUser(
  world: World,
  path: string,
  input: unknown,
  compare: unknown = {},
): Promise<Reply> {
  return call(world.server, path, USER_TOKEN, command(input, { compare }));
}

async function userRead(world: World, path: string, input: unknown) {
  const reply = await call(world.server, path, USER_TOKEN, input);
  assertEquals(reply.status, 200, JSON.stringify(reply.body));
  return reply.body;
}

type Entry = {
  target: { kind: string; document: string; section: string | null };
  perspective: string;
  reason: string;
};
type ContextBody = {
  id: string;
  title: string;
  purpose: string;
  items: Entry[];
  revision: string;
  status: string;
};
type TermBody = {
  id: string;
  name: string;
  definition: string | null;
  revision: string;
  status: string;
};

async function contextOf(world: World, context: string): Promise<ContextBody> {
  return (await userRead(world, "contexts/get", { context }))[
    "context"
  ] as ContextBody;
}

async function termOf(world: World, term: string): Promise<TermBody> {
  return (await userRead(world, "terms/get", { term }))["term"] as TermBody;
}

function entry(
  document: string,
  perspective: string,
  reason: string,
  section: string | null = null,
) {
  return {
    target: { kind: "document", document, section },
    perspective,
    reason,
  };
}

function evidence(document: string, version: string, section = "요약") {
  return { document, version, section, start_line: null, end_line: null };
}

function revisionOf(outcome: { result: { content: unknown } }, key: string) {
  const value = contentOf(outcome)[key] as { revision: string };
  return value.revision;
}

// run이 하기 전의 일(사람이 만든 context 하나와 정의한 용어)과 run이 한 일. Context Engineer가 기존
// context의 이름·목적·항목을 바꾸고, 새 context를 만들어 항목을 더하고, 용어 후보를 제안하고, 사람이 만든
// 후보를 고쳤다가 보관한다. 사람이 정의한 용어는 건드리지 않는다.
async function agentWork(world: World) {
  const source = await world.seed(PLACE, "terms", SOURCE, "용어");
  const other = await world.seed(
    PLACE,
    "other",
    "# 다른\n\n## 개요\n\n본문\n",
    "다른",
  );
  const made = await asUser(world, "contexts/create", {
    id: CTX_OLD,
    title: "기존",
    purpose: "처음 목적",
    items: [entry(source.document, "basis", "기준 자료")],
  });
  assertEquals(made.status, 200, JSON.stringify(made.body));
  await startRun(world);
  const run = world.tools().run;
  // 후보 근거는 이 run이 읽은 고정 판이어야 한다. 읽은 뒤 사람이 후보와 정의를 더한다.
  await readWhole(run, source.document, source.version);
  const candidate = await asUser(world, "terms/propose", {
    id: TRM_USER,
    context: CTX_OLD,
    name: "범위",
    evidence: [evidence(source.document, source.version)],
  });
  assertEquals(candidate.status, 200, JSON.stringify(candidate.body));
  const defined = await asUser(world, "terms/define", {
    id: TRM_DEFINED,
    context: CTX_OLD,
    name: "정의된 말",
    definition: "사람이 정한 뜻",
  });
  assertEquals(defined.status, 200, JSON.stringify(defined.body));

  const read = await run("context.read", { context: CTX_OLD });
  assertEquals(read.outcome.kind, "success", JSON.stringify(read.result));
  let revision = revisionOf(read, "context");
  const steps: [string, Record<string, unknown>][] = [
    ["context.rename", { context: CTX_OLD, title: "기존 개정" }],
    ["context.set_purpose", { context: CTX_OLD, purpose: "새 목적" }],
    ["context.add_item", {
      context: CTX_OLD,
      item: entry(other.document, "reference", "배경 지식"),
      position: 0,
    }],
    ["context.update_item", {
      context: CTX_OLD,
      item: entry(source.document, "watch", "변화만 따라간다"),
    }],
  ];
  let n = 0;
  for (const [tool, input] of steps) {
    n += 1;
    const done = await run(
      tool,
      { ...input, base_revision: revision },
      id("tcl", n),
    );
    assertEquals(
      done.outcome.kind,
      "success",
      `${tool} ${JSON.stringify(done.result)}`,
    );
    revision = revisionOf(done, "context");
  }
  const created = await run("context.create", {
    title: "새 맥락",
    purpose: "run이 만든 맥락",
    items: [entry(source.document, "basis", "근거")],
  }, id("tcl", 10));
  assertEquals(created.outcome.kind, "success", JSON.stringify(created.result));
  const fresh = contentOf(created)["context"] as {
    id: string;
    revision: string;
  };
  const grown = await run("context.add_item", {
    context: fresh.id,
    item: entry(other.document, "reference", "배경"),
    base_revision: fresh.revision,
  }, id("tcl", 11));
  assertEquals(grown.outcome.kind, "success", JSON.stringify(grown.result));
  const proposed = await run("term.propose_candidate", {
    context: CTX_OLD,
    name: "대상",
    evidence: [evidence(source.document, source.version)],
  }, id("tcl", 12));
  assertEquals(
    proposed.outcome.kind,
    "success",
    JSON.stringify(proposed.result),
  );
  const mine = contentOf(proposed)["term"] as TermBody;
  const theirs = await run("term.read", { term: TRM_USER });
  const renamed = await run("term.update_candidate", {
    term: TRM_USER,
    name: "판단",
    base_revision: (contentOf(theirs)["term"] as TermBody).revision,
  }, id("tcl", 13));
  assertEquals(renamed.outcome.kind, "success", JSON.stringify(renamed.result));
  const removed = await run("term.remove_candidate", {
    term: TRM_USER,
    base_revision: (contentOf(renamed)["term"] as TermBody).revision,
  }, id("tcl", 14));
  assertEquals(removed.outcome.kind, "success", JSON.stringify(removed.result));
  await finishRun(world);
  return { source, other, fresh: fresh.id, mine: mine.id };
}

// 사람이 본 preview의 묶음으로 RevertRun 입력을 만들어 확인 handle과 함께 적용한다. context·term 묶음은
// 복원에 준비 결과가 필요 없다.
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
      allowed_decisions: [revertRun.name],
      expires_at: new Date(Date.UTC(2024, 0, 1) + 600_000).toISOString(),
    },
  });
  assert(issued.ok, issued.ok ? "" : issued.error.message);
  return (issued.value as { confirmation: string }).confirmation;
}

async function revert(world: World, shown: Preview, revertId = id("rvt", 1)) {
  const groups = await buildRevertInput(
    shown.groups,
    () => Promise.resolve(ok(null)),
  );
  assert(groups.ok);
  const input = {
    id: revertId,
    run: RUN_A,
    allow_partial: false,
    preview_hash: shown.binding_hash,
    groups: groups.value,
  };
  return await call(
    world.server,
    "reverts/apply",
    USER_TOKEN,
    command(input, {
      compare: { preview_hash: shown.binding_hash },
      confirmation: await handleFor(world, input),
    }),
  );
}

function groupOf(shown: Preview, owner: string, target: string) {
  return shown.groups.find((group) =>
    group.owner === owner && group.target === target
  );
}

function runEventCount(world: World): number {
  return count(
    world.server,
    "select count(*) as n from events where run = ?",
    [RUN_A],
  );
}

Deno.test("lophn-agent/revert#R5: Context Engineer run의 context·용어 후보 변경은 documents의 보상 command로 복원되고 사람이 정의한 용어와 run의 사실은 그대로다", async () => {
  const world = await open();
  try {
    const work = await agentWork(world);
    const shown = await previewOf(world);
    // 네 대상이 복원 가능이고 보상 열이 사람이 본 복원 기준에 실린다.
    for (
      const [owner, target] of [
        ["documents/contexts", CTX_OLD],
        ["documents/contexts", work.fresh],
        ["documents/terms", work.mine],
        ["documents/terms", TRM_USER],
      ] as const
    ) {
      const group = groupOf(shown, owner, target);
      assert(group !== undefined, `${owner} ${target}`);
      assertEquals(group.capability, "reversible", JSON.stringify(group));
      assertEquals(group.reason, null);
    }
    const old = groupOf(shown, "documents/contexts", CTX_OLD)!;
    assertEquals(
      (old.comparison as { steps: { op: string }[] }).steps.map((step) =>
        step.op
      ),
      ["set_item", "remove_item", "update", "update"],
    );
    assertEquals(
      (groupOf(shown, "documents/contexts", work.fresh)!.comparison as {
        steps: unknown[];
      }).steps,
      [{ op: "archive" }],
    );
    // 사람이 정의한 용어는 이 run의 변경이 아니라서 묶음에 없다. 나머지는 모두 유지하는 사실이다.
    assertEquals(groupOf(shown, "documents/terms", TRM_DEFINED), undefined);
    for (const group of shown.groups) {
      if (group.capability === "reversible") continue;
      assertEquals(group.capability, "retained", JSON.stringify(group));
      assertEquals(group.reason, "audit_fact");
    }
    const covered = shown.groups.flatMap((group) => group.source_seqs);
    assertEquals(new Set(covered).size, covered.length);
    const eventsBefore = runEventCount(world);
    const head = count(world.server, "select max(seq) as n from events");
    const contextRevision = (await contextOf(world, CTX_OLD)).revision;

    const reply = await revert(world, shown);
    assertEquals(reply.status, 200, JSON.stringify(reply.body));
    assertEquals(reply.body["outcome"], "applied");

    // 기존 context는 이름·목적·항목(관점·이유·자리)이 run 전과 같다. 판은 새 revision이다.
    const restored = await contextOf(world, CTX_OLD);
    assertEquals(restored.title, "기존");
    assertEquals(restored.purpose, "처음 목적");
    assertEquals(restored.status, "active");
    assertEquals(restored.items.length, 1);
    assertEquals(restored.items[0].target.document, work.source.document);
    assertEquals(restored.items[0].perspective, "basis");
    assertEquals(restored.items[0].reason, "기준 자료");
    assert(restored.revision !== contextRevision);
    // run이 만든 context는 삭제가 아니라 보관됐다.
    const made = await contextOf(world, work.fresh);
    assertEquals(made.status, "archived");
    assertEquals(made.items.length, 2);
    // 용어 후보: run이 제안한 것은 보관, 사람의 후보는 이름과 상태가 원래대로, 정의는 그대로다.
    assertEquals((await termOf(world, work.mine)).status, "archived");
    const theirs = await termOf(world, TRM_USER);
    assertEquals(theirs.name, "범위");
    assertEquals(theirs.status, "active");
    assertEquals(theirs.definition, null);
    const defined = await termOf(world, TRM_DEFINED);
    assertEquals(defined.definition, "사람이 정한 뜻");
    assertEquals(defined.name, "정의된 말");
    assertEquals(defined.status, "active");
    // run의 원래 event는 그대로이고 복원은 사람(user)의 새 event다.
    assertEquals(runEventCount(world), eventsBefore);
    const added = inspect(
      world.server,
      "select type, actor, run from events where seq > ? order by seq",
      [head],
    );
    for (const event of added) {
      assertEquals(event["actor"], "user");
      assertEquals(event["run"], null);
    }
    const types = added.map((event) => String(event["type"]));
    const counted = (type: string) =>
      types.filter((candidate) => candidate === type).length;
    assertEquals(counted("ContextUpdated"), 2);
    assertEquals(counted("ContextItemSet"), 1);
    assertEquals(counted("ContextItemRemoved"), 1);
    assertEquals(counted("ContextArchived"), 1);
    assertEquals(counted("TermArchived"), 1);
    assertEquals(counted("TermUnarchived"), 1);
    assertEquals(counted("TermUpdated"), 1);
    assertEquals(counted("TermDefined"), 0);
    assertEquals(types[types.length - 1], "RevertApplied");
    const listed = await call(world.server, "reverts/list", USER_TOKEN, {
      run: RUN_A,
    });
    const record = (listed.body["reverts"] as {
      outcome: string;
      changes: {
        owner: string;
        capability: string;
        result: string;
        restored_seqs: string[];
      }[];
    }[])[0];
    assertEquals(record.outcome, "applied");
    const done = record.changes.filter((change) =>
      change.result === "restored"
    );
    assertEquals(done.length, 4);
    assert(done.every((change) => change.restored_seqs.length > 0));
    // 같은 revert 요청을 되풀이해도 복원은 한 번이다.
    const again = await revert(world, shown);
    assertEquals(again.body["replayed"], true);
    assertEquals(counted("ContextUpdated"), 2);
    assertEquals(
      count(world.server, "select count(*) as n from events where seq > ?", [
        head,
      ]),
      added.length,
    );
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/revert#R4: run 뒤에 사람이 context를 고치면 어느 context·용어도 복원하지 않고 blocked 결과를 남긴다", async () => {
  const world = await open();
  try {
    const work = await agentWork(world);
    // 사람이 run이 끝난 뒤 같은 context의 이름을 바꿨다(run 전 값으로의 되돌림이 아니다).
    const current = await contextOf(world, CTX_OLD);
    const edited = await asUser(
      world,
      "contexts/update",
      { context: CTX_OLD, title: "사람이 고친 이름" },
      { base_revision: current.revision },
    );
    assertEquals(edited.status, 200, JSON.stringify(edited.body));
    const shown = await previewOf(world);
    const conflict = groupOf(shown, "documents/contexts", CTX_OLD)!;
    assertEquals(conflict.capability, "conflict");
    assertEquals(conflict.reason, "later_change");
    // 다른 대상은 복원할 수 있지만 전체가 막힌다.
    assertEquals(
      groupOf(shown, "documents/contexts", work.fresh)!.capability,
      "reversible",
    );
    const head = count(world.server, "select max(seq) as n from events");
    const reply = await revert(world, shown);
    assertEquals(reply.status, 200, JSON.stringify(reply.body));
    assertEquals(reply.body["outcome"], "blocked");
    assertEquals((await contextOf(world, work.fresh)).status, "active");
    assertEquals((await contextOf(world, CTX_OLD)).title, "사람이 고친 이름");
    assertEquals((await termOf(world, work.mine)).status, "active");
    assertEquals((await termOf(world, TRM_USER)).status, "archived");
    const added = inspect(
      world.server,
      "select type from events where seq > ? order by seq",
      [head],
    ).map((row) => row["type"]);
    assertEquals(added, ["RevertBlocked"]);
    // 사람이 용어 후보를 정의해도 그 후보의 복원은 충돌이다. 정의를 지우거나 덮어쓰지 않는다.
    const refreshed = await termOf(world, work.mine);
    const defined = await asUser(world, "terms/define", {
      term: work.mine,
      name: "대상",
      definition: "사람이 정한 대상",
    }, { base_revision: refreshed.revision });
    assertEquals(defined.status, 200, JSON.stringify(defined.body));
    const next = await previewOf(world);
    assertEquals(
      groupOf(next, "documents/terms", work.mine)!.capability,
      "conflict",
    );
  } finally {
    await world.dispose();
  }
});

Deno.test("roles/context-engineer#R5: agent는 정의를 쓰지 못하고 정의된 용어와 해제 같은 사람 몫의 변경 경로가 없으며 거절된 호출은 아무 event도 남기지 않는다", async () => {
  const world = await open();
  try {
    const source = await world.seed(PLACE, "terms", SOURCE, "용어");
    const made = await asUser(world, "contexts/create", {
      id: CTX_OLD,
      title: "기존",
      purpose: "처음 목적",
      items: [],
    });
    assertEquals(made.status, 200, JSON.stringify(made.body));
    await startRun(world);
    const run = world.tools().run;
    await readWhole(run, source.document, source.version);
    const proposed = await run("term.propose_candidate", {
      context: CTX_OLD,
      name: "범위",
      evidence: [evidence(source.document, source.version)],
    }, id("tcl", 1));
    assertEquals(
      proposed.outcome.kind,
      "success",
      JSON.stringify(proposed.result),
    );
    const candidate = contentOf(proposed)["term"] as TermBody;
    const defined = await asUser(world, "terms/define", {
      id: TRM_DEFINED,
      context: CTX_OLD,
      name: "정의된 말",
      definition: "사람이 정한 뜻",
    });
    assertEquals(defined.status, 200, JSON.stringify(defined.body));
    const head = count(world.server, "select max(seq) as n from events");
    // 후보 tool은 정의 입력을 받지 않는다(진입 전 거절).
    const withDefinition = await run("term.update_candidate", {
      term: candidate.id,
      name: "범위",
      definition: "에이전트가 쓴 뜻",
      base_revision: candidate.revision,
    });
    assertEquals(withDefinition.outcome.code, "invalid_input");
    assertEquals(withDefinition.executed, false);
    // 정의된 용어는 읽어도 후보 tool로 바꾸거나 보관하지 못한다.
    const read = await run("term.read", { term: TRM_DEFINED });
    const revision = (contentOf(read)["term"] as TermBody).revision;
    for (
      const [tool, input] of [
        ["term.update_candidate", {
          term: TRM_DEFINED,
          name: "다른 이름",
          base_revision: revision,
        }],
        ["term.remove_candidate", {
          term: TRM_DEFINED,
          base_revision: revision,
        }],
      ] as const
    ) {
      const refused = await run(tool, input);
      assertEquals(refused.outcome.code, "invalid_input", tool);
    }
    // tool을 거치지 않고 agent 자격으로 owner route를 직접 불러도 정의는 forbidden이고 해제·정의 확정은
    // 자격에 없다.
    const direct = await call(
      world.server,
      "terms/update",
      AGENT_TOKEN,
      {
        ...command(
          { term: candidate.id, definition: "직접 쓴 뜻" },
          { compare: { base_revision: candidate.revision } },
        ),
        run: RUN_A,
      },
    );
    assertEquals(direct.status, 403, JSON.stringify(direct.body));
    for (
      const [path, input, compare] of [
        [
          "terms/define",
          { term: candidate.id, name: "범위", definition: "뜻" },
          { base_revision: candidate.revision },
        ],
        ["terms/unarchive", { term: candidate.id }, {
          base_revision: candidate.revision,
        }],
        ["contexts/unarchive", { context: CTX_OLD }, {
          base_revision: (await contextOf(world, CTX_OLD)).revision,
        }],
      ] as const
    ) {
      const refused = await call(world.server, path, AGENT_TOKEN, {
        ...command(input, { compare }),
        run: RUN_A,
      });
      assert(
        refused.status >= 400 && refused.status < 500,
        `${path} ${refused.status}`,
      );
    }
    assertEquals(
      count(world.server, "select count(*) as n from events where seq > ?", [
        head,
      ]),
      0,
    );
    assertEquals(
      (await termOf(world, TRM_DEFINED)).definition,
      "사람이 정한 뜻",
    );
    assertEquals((await termOf(world, candidate.id)).definition, null);
  } finally {
    await world.dispose();
  }
});

Deno.test("roles/context-engineer#R4: 읽기 tool은 실제 core에서 context·항목·용어·문서 소속·project를 읽고 어떤 event도 만들지 않는다", async () => {
  const world = await open();
  try {
    const source = await world.seed(PLACE, "terms", SOURCE, "용어");
    const made = await asUser(world, "contexts/create", {
      id: CTX_OLD,
      title: "기존",
      purpose: "처음 목적",
      items: [entry(source.document, "basis", "기준 자료", "요약")],
    });
    assertEquals(made.status, 200, JSON.stringify(made.body));
    await startRun(world);
    const run = world.tools().run;
    await readWhole(run, source.document, source.version);
    const candidate = await asUser(world, "terms/propose", {
      id: TRM_USER,
      context: CTX_OLD,
      name: "범위",
      evidence: [evidence(source.document, source.version)],
    });
    assertEquals(candidate.status, 200, JSON.stringify(candidate.body));
    const head = count(world.server, "select max(seq) as n from events");
    const listing = await run("context.list", {});
    assertEquals(
      listing.outcome.kind,
      "success",
      JSON.stringify(listing.result),
    );
    const contexts = contentOf(listing)["contexts"] as ContextBody[];
    assertEquals(contexts.map((context) => context.id), [CTX_OLD]);
    assertEquals(
      (contexts[0] as unknown as { item_count: number }).item_count,
      1,
    );
    const read = await run("context.read", { context: CTX_OLD });
    assertEquals(read.outcome.kind, "success", JSON.stringify(read.result));
    assertEquals((contentOf(read)["items"] as Entry[])[0].perspective, "basis");
    const items = await run("context.items", { context: CTX_OLD });
    assertEquals(items.outcome.kind, "success", JSON.stringify(items.result));
    assertEquals((contentOf(items)["entries"] as unknown[]).length, 1);
    const terms = await run("context.terms", { context: CTX_OLD });
    assertEquals(terms.outcome.kind, "success", JSON.stringify(terms.result));
    assertEquals(
      (contentOf(terms)["candidates"] as TermBody[]).map((term) => term.id),
      [TRM_USER],
    );
    assertEquals(contentOf(terms)["definitions"], []);
    const membership = await run("context.document_membership", {
      document: source.document,
      section: "요약",
    });
    assertEquals(
      membership.outcome.kind,
      "success",
      JSON.stringify(membership.result),
    );
    assertEquals(
      (contentOf(membership)["contexts"] as ContextBody[]).map((context) =>
        context.id
      ),
      [CTX_OLD],
    );
    const term = await run("term.read", { term: TRM_USER });
    assertEquals((contentOf(term)["term"] as TermBody).name, "범위");
    const projects = await run("project.list", {});
    assertEquals(
      projects.outcome.kind,
      "success",
      JSON.stringify(projects.result),
    );
    const project = await run("project.read", { project: PROJECT });
    assertEquals(
      project.outcome.kind,
      "success",
      JSON.stringify(project.result),
    );
    for (const outcome of [projects, project]) {
      assertEquals(JSON.stringify(outcome.result).includes(world.work), false);
    }
    // 없는 context와 같은 답이고 읽기는 event를 만들지 않는다.
    const absent = await run("context.read", { context: id("ctx", 90) });
    assertEquals(absent.outcome.kind, "failure");
    assertEquals(absent.result.summary, "tool target is not available");
    assertEquals(
      count(world.server, "select count(*) as n from events where seq > ?", [
        head,
      ]),
      0,
    );
  } finally {
    await world.dispose();
  }
});
