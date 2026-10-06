// lophn-agent#T23 끝에서 끝까지: 문서·format tool을 실제 core, documents worker, I/O worker에
// 연다(모두 실제 자식 프로세스이고 데이터 root는 temp dir다. 사람 데이터 root는 열지 않는다).
// model provider는 부르지 않는다. 문서는 coding agent 자격의 실제 저장 통로로 먼저 만들고, tool은
// run에 묶인 agent 자격으로 같은 core의 HTTP route를 부른다. agent 자격이 부르는 route는 tool이
// 가리키는 소유 contract뿐이다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, ok, seededRandom } from "../../packages/base/mod.ts";
import type { Result } from "../../packages/base/mod.ts";
import { ROUTES as DOCUMENT_ROUTES } from "../../packages/contracts/documents/mod.ts";
import { ROUTES as AGENT_ROUTES } from "../../packages/contracts/lophn-agent/mod.ts";
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
} from "../../packages/lophn-agent/harness/tools/mod.ts";
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
const OTHER_PROJECT = id("prj", 2);
const PLACE = { kind: "project" as const, id: PROJECT };
const OTHER_PLACE = { kind: "project" as const, id: OTHER_PROJECT };
const MACHINE_TOKEN = "m".repeat(43);
const USER_TOKEN = "u".repeat(43);
const SEED_TOKEN = "s".repeat(43);
const RUN_A = id("run", 1);
const MSG_ONE = id("msg", 1);
const AGENT_TOKEN = "x".repeat(43);
const FORMAT_DOCUMENT = "document";

// agent 자격이 가지는 operation. tool이 가리키는 소유 contract이고, 문서 저장은 core가 요청 자격으로
// 준비·확정하므로 document.prepare·document.save를 함께 가진다. 그 밖의 문서 관리 operation은 없다.
const TOOL_CONTRACTS = [...new Set(BUILTIN_TOOLS.map((tool) => tool.contract))];
const AGENT_OPERATIONS = [
  ...TOOL_CONTRACTS,
  "document.prepare",
  "document.save",
  "document.file",
  "document.get",
];

type World = {
  core: Core;
  server: Server;
  home: string;
  work: string;
  assignment: string;
  seed: ReturnType<typeof seeder>;
  tools(options?: { call?: string; targets?: Record<string, string> }): {
    run(tool: string, input: unknown, call?: string): ReturnType<
      typeof executeTool
    >;
  };
  agentPost(path: string, body: unknown): Promise<Reply>;
  dispose(): Promise<void>;
};

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

async function open(
  options: { scopeTargets?: Record<string, string> } = {},
): Promise<World> {
  const home = await Deno.makeTempDir({ prefix: "lophn-document-tools-" });
  const work = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-document-tools-work-" }),
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
    random: seededRandom(23),
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
    scope: { operations: ["ListAssignments", "AcceptRun"], targets: {} },
    conditions: {},
    credential_ref: "cred-machine",
  }, MACHINE_TOKEN);
  await accept(core, {
    principal: "user",
    actor: "user",
    scope: {
      operations: [
        "project.create",
        "document.archive",
        "document.history",
        "document.list",
        "document.get",
      ],
      targets: {},
    },
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
  const assignments = listed.body["assignments"] as {
    id: string;
    role: string;
    revision: number;
  }[];
  const lophn = assignments.find((entry) => entry.role === "lophn");
  assert(lophn !== undefined);
  const accepted = await call(
    server,
    "runs/accept",
    MACHINE_TOKEN,
    command({
      id: RUN_A,
      assignment: lophn.id,
      session: null,
      source: { kind: "message", message: MSG_ONE },
      continued_from: null,
      start_after: null,
    }, { compare: { assignment_revision: lophn.revision } }),
  );
  assertEquals(accepted.status, 200, JSON.stringify(accepted.body));
  const targets = {
    assignment: lophn.id,
    run: RUN_A,
    ...(options.scopeTargets ?? {}),
  };
  await accept(core, {
    principal: `agent:${lophn.id}`,
    actor: `agent:${lophn.id}`,
    scope: { operations: AGENT_OPERATIONS, targets },
    conditions: { assignment: lophn.id, run: RUN_A },
    credential_ref: `cred-agent-${RUN_A}`,
  } as AuthenticatedContext, AGENT_TOKEN);
  const project = (project: string, name: string) =>
    call(
      server,
      "projects/create",
      USER_TOKEN,
      command({
        id: project,
        name,
        title: name,
        purpose: "",
        folders: [{ path: `${work}/${name}-folder`, description: "" }],
        tracking: { enabled: false, patterns: [], use_gitignore: false },
      }),
    );
  for (
    const [project_, name] of [[PROJECT, "alpha"], [OTHER_PROJECT, "beta"]]
  ) {
    const created = await project(project_, name);
    assertEquals(created.status, 200, JSON.stringify(created.body));
  }
  const routes = new Map<string, { resource: string; method: string }>(
    [...DOCUMENT_ROUTES, ...AGENT_ROUTES].map((
      route,
    ) => [route.name, route]),
  );
  // tool handler가 소유 contract를 부르는 통로다. run에 묶인 agent 자격의 HTTP route만 쓴다.
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
  // 읽기 기록은 handler 묶음 하나가 run 동안 쥔다.
  const handlers = createBuiltinToolHandlers(ports);
  return {
    core,
    server,
    home,
    work,
    assignment: lophn.id,
    seed: seeder(core, work, home),
    tools(config = {}) {
      return {
        run(tool, input, callId = config.call) {
          const credential: RunCredential = {
            run: RUN_A,
            targets: new Set(),
            operations: new Set(AGENT_OPERATIONS),
            ...(callId === undefined ? {} : { call: callId }),
          };
          return executeTool(
            { listed: listedTools, handlers, credential },
            tool,
            input,
          );
        },
      };
    },
    agentPost: (path, body) => call(server, path, AGENT_TOKEN, body),
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

// 본문 읽기는 파생 자료(section 추출)가 준비된 뒤에 나온다. 준비 전에는 추출 미확인으로 본문이 없다.
// 본문이 올 때까지 기다린다. 읽은 기록은 본문을 받은 읽기만 남긴다.
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

const PLAN = [
  "# 계획",
  "",
  "## 목표",
  "",
  "첫째 줄",
  "둘째 줄",
  "",
  "## 범위",
  "",
  "셋째 줄",
  "",
].join("\n");

// 같은 입력의 결과가 없는 대상과 같은지 본다: 이름·존재가 새지 않는다.
function sameAnswer(
  left: { outcome: unknown; result: unknown },
  right: { outcome: unknown; result: unknown },
) {
  assertEquals(left.outcome, right.outcome);
  assertEquals(left.result, right.result);
}

Deno.test("lophn-agent/harness/tools#R6: 실제 core에서 허용 place 안의 목록·목차·본문·절·범위·이력이 읽히고 범위 밖 place는 없는 place와 같다", async () => {
  const world = await open({
    scopeTargets: { place_kind: "project", place: PROJECT },
  });
  try {
    const plan = await world.seed(PLACE, "plan", PLAN, "계획");
    const hidden = await world.seed(OTHER_PLACE, "secret", "# 비밀\n\n본문\n");
    const run = world.tools().run;

    const listed = await run("document.list", { place: PLACE });
    assertEquals(listed.outcome.kind, "success", JSON.stringify(listed.result));
    const entries = contentOf(listed)["documents"] as {
      document: { id: string };
    }[];
    assertEquals(entries.map((entry) => entry.document.id), [plan.document]);

    // 범위 밖 place와 없는 place는 같은 답이다.
    const outside = await run("document.list", { place: OTHER_PLACE });
    const absent = await run("document.list", {
      place: { kind: "project", id: id("prj", 30) },
    });
    sameAnswer(outside, absent);
    const outsideHistory = await run("document.history", {
      document: hidden.document,
    });
    const absentHistory = await run("document.history", {
      document: id("doc", 31),
    });
    sameAnswer(outsideHistory, absentHistory);
    assertEquals(outsideHistory.outcome.kind, "failure");
    assertEquals(
      JSON.stringify(outsideHistory.result).includes(hidden.document),
      false,
    );

    const history = await run("document.history", { document: plan.document });
    assertEquals(history.outcome.kind, "success", JSON.stringify(history));
    assertEquals(
      (contentOf(history)["versions"] as { id: string }[]).map((v) => v.id),
      [plan.version],
    );

    const outline = await run("document.outline", {
      reference: {
        document: plan.document,
        version: plan.version,
        section: null,
      },
    });
    assertEquals(outline.outcome.kind, "success", JSON.stringify(outline));

    const whole = await readWhole(run, plan.document, plan.version);
    assertEquals(whole.outcome.kind, "success", JSON.stringify(whole));
    assertEquals(contentOf(whole)["text"], PLAN);
    assertEquals(whole.result.complete, true);
    assertEquals(whole.result.source?.version, plan.version);

    const section = await run("document.read_section", {
      reference: {
        document: plan.document,
        version: plan.version,
        section: null,
      },
      section: "목표",
    });
    assertEquals(section.outcome.kind, "success", JSON.stringify(section));
    assert(String(contentOf(section)["text"]).includes("첫째 줄"));
    assertEquals(String(contentOf(section)["text"]).includes("셋째 줄"), false);

    const range = await run("document.read_range", {
      reference: {
        document: plan.document,
        version: plan.version,
        section: null,
      },
      ranges: [{ start_line: 5, end_line: 6 }],
    });
    assertEquals(range.outcome.kind, "success", JSON.stringify(range));
    assertEquals(contentOf(range)["text"], "첫째 줄\n둘째 줄");

    // 범위 밖 문서의 본문 읽기도 없는 문서와 같다.
    const hiddenRead = await run("document.read_version", {
      reference: {
        document: hidden.document,
        version: hidden.version,
        section: null,
      },
    });
    const absentRead = await run("document.read_version", {
      reference: {
        document: id("doc", 32),
        version: id("ver", 32),
        section: null,
      },
    });
    sameAnswer(hiddenRead, absentRead);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/tools#R6: 실제 core에서 새 판의 차이와 검색이 읽힌다", async () => {
  const world = await open();
  try {
    const first = await world.seed(PLACE, "plan", PLAN, "계획");
    const second = await world.seed(
      PLACE,
      "plan",
      PLAN.replace("셋째 줄", "셋째 줄을 고쳤다"),
      "계획",
    );
    assertEquals(second.document, first.document);
    assert(second.version !== first.version);
    const run = world.tools().run;
    // 차이와 검색은 파생 자료가 준비된 뒤에 나온다. 준비될 때까지 기다린다.
    let diff = await run("document.diff", {
      document: first.document,
      before: first.version,
      after: second.version,
    });
    for (let tries = 0; tries < 40; tries += 1) {
      const additions = contentOf(diff)["additions"] as unknown[] | undefined;
      if (diff.outcome.kind === "success" && (additions ?? []).length > 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      diff = await run("document.diff", {
        document: first.document,
        before: first.version,
        after: second.version,
      });
    }
    assertEquals(diff.outcome.kind, "success", JSON.stringify(diff));
    const text = JSON.stringify(contentOf(diff)["additions"]);
    assert(text.includes("셋째 줄을 고쳤다"), text);

    let found: Record<string, unknown>[] = [];
    for (let tries = 0; tries < 40 && found.length === 0; tries += 1) {
      const searched = await run("document.search", {
        query: "셋째 줄을 고쳤다",
      });
      assertEquals(searched.outcome.kind, "success", JSON.stringify(searched));
      found = (contentOf(searched)["results"] ?? []) as Record<
        string,
        unknown
      >[];
      if (found.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    assert(found.length > 0, "search did not find the saved text");
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/tools#R6: 실제 core에서 새 문서와 읽은 version 기준의 새 version이 agent 자격의 고정 판으로 남고 같은 ToolCall의 재전송은 판을 더하지 않는다", async () => {
  const world = await open();
  try {
    const run = world.tools().run;
    const created = await run("document.create", {
      title: "기획",
      place: PLACE,
      name: "design",
      text: "# 기획\n\n처음 본문\n",
      media_type: "text/markdown",
    }, id("tcl", 1));
    assertEquals(created.outcome.kind, "success", JSON.stringify(created));
    const first = contentOf(created);
    assertEquals(first["status"], "saved");
    assertEquals(first["accepted"], true);
    assertEquals(first["version_confirmed"], true);
    assertEquals(first["file_reflection"], "not_applicable");
    const document = first["document"] as string;
    const version = first["version"] as string;
    // 같은 ToolCall의 재전송은 같은 판이다.
    const replay = await run("document.create", {
      title: "기획",
      place: PLACE,
      name: "design",
      text: "# 기획\n\n처음 본문\n",
      media_type: "text/markdown",
    }, id("tcl", 1));
    assertEquals(contentOf(replay)["version"], version);
    assertEquals(contentOf(replay)["document"], document);
    // 판은 agent 자격과 run으로 남는다.
    const history = await world.agentPost("documents/history", { document });
    assertEquals(history.status, 200, JSON.stringify(history.body));
    const versions = history.body["versions"] as {
      id: string;
      saved_by: string;
      run: string | null;
    }[];
    assertEquals(versions.length, 1);
    assertEquals(versions[0].saved_by, `agent:${world.assignment}`);
    assertEquals(versions[0].run, RUN_A);

    // 읽지 않은 기준 위에는 저장하지 않는다. 읽은 뒤에는 새 판이 된다.
    const unread = await world.tools().run("document.save_version", {
      document,
      base_version: version,
      text: "# 기획\n\n고친 본문\n",
      media_type: "text/markdown",
    }, id("tcl", 2));
    // 이 run은 방금 만든 문서를 아직 읽지 않았다.
    assertEquals(unread.outcome, { kind: "failure", code: "invalid_input" });
    await readWhole(run, document, version);
    const saved = await run("document.save_version", {
      document,
      base_version: version,
      text: "# 기획\n\n고친 본문\n",
      media_type: "text/markdown",
    }, id("tcl", 3));
    assertEquals(saved.outcome.kind, "success", JSON.stringify(saved));
    assertEquals(contentOf(saved)["status"], "saved");
    const next = contentOf(saved)["version"] as string;
    assert(next !== version);
    // 같은 내용을 다시 저장하면 새 판은 없다.
    await readWhole(run, document, next);
    const same = await run("document.save_version", {
      document,
      base_version: next,
      text: "# 기획\n\n고친 본문\n",
      media_type: "text/markdown",
    }, id("tcl", 4));
    assertEquals(contentOf(same)["status"], "unchanged");
    assertEquals(contentOf(same)["version"], next);
    // 저장된 바이트는 보낸 글이다.
    const file = await fetch(
      `http://127.0.0.1:${world.core.port}/v1/documents/file`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${AGENT_TOKEN}`,
        },
        body: JSON.stringify({ version: next, path: "document.md" }),
      },
    );
    assertEquals(file.status, 200);
    assertEquals(await file.text(), "# 기획\n\n고친 본문\n");
    assertEquals(
      count(world.server, "select count(*) as n from versions"),
      2,
    );
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/roles/common#R7: 읽은 뒤 사람이 고친 문서의 저장은 conflict이고 새 판이 생기지 않는다", async () => {
  const world = await open();
  try {
    const run = world.tools().run;
    const base = await world.seed(PLACE, "plan", PLAN, "계획");
    await readWhole(run, base.document, base.version);
    // 읽은 뒤 사람이 같은 문서에 새 판을 저장했다.
    const human = await world.seed(
      PLACE,
      "plan",
      PLAN + "\n사람이 더했다\n",
      "계획",
    );
    assertEquals(human.document, base.document);
    const stale = await run("document.save_version", {
      document: base.document,
      base_version: base.version,
      text: PLAN + "\n에이전트가 더했다\n",
      media_type: "text/markdown",
    }, id("tcl", 5));
    assertEquals(stale.outcome, { kind: "failure", code: "conflict" });
    assertEquals(
      count(
        world.server,
        "select count(*) as n from versions where document = ?",
        [
          base.document,
        ],
      ),
      2,
    );
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/tools#R6: 보관한 문서에는 agent 출력이 쓰이지 않고 documents의 저장 범위가 그대로 적용된다", async () => {
  const world = await open();
  try {
    const run = world.tools().run;
    const base = await world.seed(PLACE, "old", PLAN, "옛 문서");
    await readWhole(run, base.document, base.version);
    const revision = String(
      inspect(world.server, "select revision from documents where id = ?", [
        base.document,
      ])[0]?.["revision"],
    );
    const archived = await call(
      world.server,
      "documents/archive",
      USER_TOKEN,
      command({ document: base.document }, {
        compare: { base_revision: revision },
      }),
    );
    assertEquals(archived.status, 200, JSON.stringify(archived.body));
    const refused = await run("document.save_version", {
      document: base.document,
      base_version: base.version,
      text: PLAN + "\n덧붙임\n",
      media_type: "text/markdown",
    }, id("tcl", 6));
    // documents가 정한 agent 출력 범위다. tool은 이 규칙을 다시 만들지 않고 그 거절을 그대로 전한다.
    assertEquals(refused.outcome, { kind: "failure", code: "forbidden" });
    assertEquals(
      count(
        world.server,
        "select count(*) as n from versions where document = ?",
        [
          base.document,
        ],
      ),
      1,
    );
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/tools#R6: 실제 core에서 본문의 secret은 가려져 저장되고 가린 글이 저장된 바이트다", async () => {
  const world = await open();
  try {
    const run = world.tools().run;
    const secret =
      "-----BEGIN PRIVATE KEY-----\nabcdef\n-----END PRIVATE KEY-----";
    const created = await run("document.create", {
      title: "메모",
      place: null,
      name: null,
      text: `# 메모\n\n열쇠는 ${secret} 이다\n`,
      media_type: "text/markdown",
    }, id("tcl", 7));
    assertEquals(created.outcome.kind, "success", JSON.stringify(created));
    const version = contentOf(created)["version"] as string;
    const file = await fetch(
      `http://127.0.0.1:${world.core.port}/v1/documents/file`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${AGENT_TOKEN}`,
        },
        body: JSON.stringify({ version, path: "document.md" }),
      },
    );
    const stored = await file.text();
    assertEquals(stored.includes("PRIVATE KEY"), false);
    assertEquals(stored.includes("abcdef"), false);
    assert(stored.startsWith("# 메모"));
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/tools#R7: 실제 core에서 format 안내는 읽기이고 본문 검사는 판과 blob 참조를 늘리지 않는다", async () => {
  const world = await open();
  try {
    const run = world.tools().run;
    const listed = await run("format.list", {});
    assertEquals(listed.outcome.kind, "success", JSON.stringify(listed));
    const formats = contentOf(listed)["formats"] as {
      name: string;
      module_hash: string;
    }[];
    const declared = formats.find((format) => format.name === FORMAT_DOCUMENT);
    assert(declared !== undefined);
    const rules = await run("format.rules", {
      name: FORMAT_DOCUMENT,
      module_hash: declared.module_hash,
    });
    assertEquals(rules.outcome.kind, "success", JSON.stringify(rules));
    assert(typeof contentOf(rules)["guide"] === "string");
    const examples = await run("format.examples", {
      name: FORMAT_DOCUMENT,
      module_hash: declared.module_hash,
    });
    assertEquals(examples.outcome.kind, "success", JSON.stringify(examples));
    assert(Array.isArray(contentOf(examples)["examples"]));

    const versions = count(world.server, "select count(*) as n from versions");
    const documents = count(
      world.server,
      "select count(*) as n from documents",
    );
    const refs = count(world.server, "select count(*) as n from blob_refs");
    const passed = await run("format.validate", {
      format: { name: FORMAT_DOCUMENT, module_hash: declared.module_hash },
      text: "# 제목\n\n본문\n",
      media_type: "text/markdown",
    });
    assertEquals(passed.outcome.kind, "success", JSON.stringify(passed));
    assertEquals(contentOf(passed)["status"], "passed");
    // 검사는 판·문서·영구 blob 참조를 만들지 않는다.
    assertEquals(
      count(world.server, "select count(*) as n from versions"),
      versions,
    );
    assertEquals(
      count(world.server, "select count(*) as n from documents"),
      documents,
    );
    assertEquals(
      count(world.server, "select count(*) as n from blob_refs"),
      refs,
    );
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/tools#R13: 실제 core에서 문서 45개는 20·20·5개로 읽고 중복과 누락이 없다", async () => {
  const world = await open();
  try {
    const seeded: string[] = [];
    for (let n = 0; n < 45; n += 1) {
      const saved = await world.seed(
        PLACE,
        `doc-${n}`,
        `# 문서 ${n}\n\n본문\n`,
      );
      seeded.push(saved.document);
    }
    const run = world.tools().run;
    const seen: string[] = [];
    const sizes: number[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const outcome = await run("document.list", {
        place: PLACE,
        ...(cursor === undefined ? {} : { cursor }),
      });
      assertEquals(outcome.outcome.kind, "success", JSON.stringify(outcome));
      const documents = contentOf(outcome)["documents"] as {
        document: { id: string };
      }[];
      sizes.push(documents.length);
      seen.push(...documents.map((entry) => entry.document.id));
      if (outcome.result.continuation === null) break;
      cursor = outcome.result.continuation.read_next!;
    }
    assertEquals(sizes, [20, 20, 5]);
    assertEquals(new Set(seen).size, 45);
    assertEquals([...seen].sort(), [...seeded].sort());
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/tools#R6: agent 자격은 blob을 직접 준비하거나 hash를 넘겨 저장하지 못하고 본문은 글 값으로만 간다", async () => {
  const world = await open();
  try {
    // agent는 upload 통로가 없다(operation 밖). 본문 blob은 core가 글 값에서 준비한다.
    const upload = await fetch(
      `http://127.0.0.1:${world.core.port}/v1/documents/upload`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${AGENT_TOKEN}`,
          "x-lophn-input": btoa(
            JSON.stringify({ blob_hash: "a".repeat(64), bytes: 3 }),
          ),
        },
        body: "abc",
      },
    );
    assertEquals(upload.status === 200, false);
    await upload.body?.cancel();
    // hash·blob 근거를 싣는 저장 요청은 route schema가 거절한다.
    const forged = await world.agentPost("tool-documents/save", {
      document: id("doc", 20),
      base_version: null,
      metadata: { title: "x", place: null, name: null },
      text: "본문",
      media_type: "text/markdown",
      format: null,
      idempotency_key: "forged-1",
      blob_hash: "a".repeat(64),
    });
    assertEquals(forged.status, 400, JSON.stringify(forged.body));
    const unknown = count(world.server, "select count(*) as n from versions");
    assertEquals(unknown, 0);
  } finally {
    await world.dispose();
  }
});
