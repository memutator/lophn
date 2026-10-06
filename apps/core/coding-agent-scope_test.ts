// coding-agent#T15 끝에서 끝까지: 실제 core(자식 프로세스)에 전체 범위 연결과 앱 하나 범위
// 연결 둘을 붙여, 범위 밖 근거가 없는 대상과 같은 답으로만 닫히는지, MCP와 CLI가 같은
// credential·입력에 같은 결과와 거절을 받는지, 금지 동작이 daemon에서 거절되는지, 운영
// data 경로가 통로 출력에 없는지 본다. 모델 provider는 부르지 않는다. 데이터 root는 temp
// dir이고 사람 데이터 root(~/.lophn)는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../packages/base/mod.ts";
import { COMMANDS, findCommand } from "../../packages/coding-agent/cli/mod.ts";
import { runSave } from "../../packages/coding-agent/cli/commands/save.ts";
import { UNREADABLE_MESSAGE } from "../../packages/coding-agent/connection/client/core.ts";
import {
  resolveTargetApp,
  withinScope,
} from "../../packages/coding-agent/connection/client/target-app.ts";
import {
  forbiddenRouteNames,
  saveFromPaths,
} from "../../packages/coding-agent/connection/mod.ts";
import { toolEntries } from "../../packages/coding-agent/mcp-server/mod.ts";
import { ALL_ROUTES } from "../../packages/contracts/mod.ts";
import type { Route } from "../../packages/contracts/platform/mod.ts";
import {
  DOCUMENT_OPERATIONS,
  openScopeWorld,
  type ScopeWorld,
  type Who,
} from "./testing/coding-agent-scope.ts";

type Saved = { document: string; version: string };
type Place = { kind: "app" | "project"; id: string };
type McpCall = [string, Record<string, unknown>];

const TEXT_A = "# 에이 계획\n\n## 개요\n에이앱 전용 본문 알파\n";
const TEXT_B = "# 비 계획\n\n## 개요\n비앱 전용 본문 베타\n";
const TEXT_P = "# 프로젝트 계획\n\n## 개요\n프로젝트 전용 본문 감마\n";
const TEXT_U = "# 자리없음 계획\n\n## 개요\n자리없는 전용 본문 델타\n";
const ABSENT_DOC = "doc_01arz3ndektsv4rrffq69g5fb9";
const ABSENT_APP = "app_01arz3ndektsv4rrffq69g5fb9";
const ATTACHMENT = "beta-attachment.txt";

type Setup = {
  world: ScopeWorld;
  a: Saved;
  b: Saved;
  p: Saved;
  u: Saved;
};

async function writeAndSave(
  world: ScopeWorld,
  slug: string,
  text: string,
  place: Place | undefined,
  extra: string[] = [],
): Promise<Saved> {
  await Deno.writeTextFile(`${world.work}/${slug}.md`, text);
  for (const name of extra) {
    await Deno.writeTextFile(`${world.work}/${name}`, `첨부 ${name}\n`);
  }
  const saved = await saveFromPaths(world.saveDeps("all"), {
    paths: [`${slug}.md`, ...extra],
    ...(place === undefined ? {} : { place, slug }),
  });
  assert(saved.ok, saved.ok ? "" : JSON.stringify(saved.error));
  await world.index(saved.value.saved, slug, text);
  return saved.value.saved;
}

// 앱 둘·project·자리 없는 문서가 한 core에 있다. 각 문서는 자기 자리의 주제만 말한다.
async function setup(): Promise<Setup> {
  const world = await openScopeWorld(DOCUMENT_OPERATIONS);
  return {
    world,
    a: await writeAndSave(world, "plan-a", TEXT_A, {
      kind: "app",
      id: world.appA,
    }),
    b: await writeAndSave(world, "plan-b", TEXT_B, {
      kind: "app",
      id: world.appB,
    }, [ATTACHMENT]),
    p: await writeAndSave(world, "plan-p", TEXT_P, {
      kind: "project",
      id: world.project,
    }),
    u: await writeAndSave(world, "plan-u", TEXT_U, undefined),
  };
}

function refOf(saved: Saved) {
  return { document: saved.document, version: saved.version, section: null };
}

// 범위 밖 문서·자리를 가리키는 읽기 요청과, 같은 요청에서 대상만 없는 것으로 바꾼 짝이다.
function hiddenPairs(
  hidden: Saved,
  place: Place,
): { hidden: McpCall; absent: McpCall }[] {
  const absentPlace = { kind: "app" as const, id: ABSENT_APP };
  const absent = { ...refOf(hidden), document: ABSENT_DOC };
  return [
    [
      ["lophn_index", { op: "document", reference: refOf(hidden) }],
      ["lophn_index", { op: "document", reference: absent }],
    ],
    [
      ["lophn_index", {
        op: "section",
        reference: { ...refOf(hidden), section: "개요" },
      }],
      ["lophn_index", {
        op: "section",
        reference: { ...absent, section: "개요" },
      }],
    ],
    [
      ["lophn_index", { op: "place", place }],
      ["lophn_index", { op: "place", place: absentPlace }],
    ],
    [
      ["lophn_read", { reference: refOf(hidden) }],
      ["lophn_read", { reference: absent }],
    ],
    [
      ["lophn_document", { op: "history", document: hidden.document }],
      ["lophn_document", { op: "history", document: ABSENT_DOC }],
    ],
    [
      ["lophn_document", {
        op: "history",
        document: hidden.document,
        section: "개요",
      }],
      ["lophn_document", {
        op: "history",
        document: ABSENT_DOC,
        section: "개요",
      }],
    ],
    [
      ["lophn_document", {
        op: "diff",
        document: hidden.document,
        before: hidden.version,
        after: hidden.version,
      }],
      ["lophn_document", {
        op: "diff",
        document: ABSENT_DOC,
        before: hidden.version,
        after: hidden.version,
      }],
    ],
    // 목록·상태는 오류가 아니라 허용된 것만 담은 빈 목록이다. 없는 자리와 같다.
    [
      ["lophn_document", { op: "list", place }],
      ["lophn_document", { op: "list", place: absentPlace }],
    ],
    [
      ["lophn_index", { op: "status", place }],
      ["lophn_index", { op: "status", place: absentPlace }],
    ],
  ].map(([hiddenCall, absentCall]) => ({
    hidden: hiddenCall as McpCall,
    absent: absentCall as McpCall,
  }));
}

Deno.test("coding-agent/connection#R5 coding-agent/mcp-server#R30: 앱 하나 연결은 다른 앱·project·자리 없는 문서의 근거를 없는 대상과 같은 답으로만 받고 제목·본문·건수·첨부가 나오지 않는다", async () => {
  const { world, a, b, p, u } = await setup();
  try {
    const seen: unknown[] = [];
    const targets: [string, Saved, Place][] = [
      ["다른 앱", b, { kind: "app", id: world.appB }],
      ["project", p, { kind: "project", id: world.project }],
    ];
    for (const [label, hidden, place] of targets) {
      for (const pair of hiddenPairs(hidden, place)) {
        const out = await world.mcp("appA", ...pair.hidden);
        const missing = await world.mcp("appA", ...pair.absent);
        const where = `${label} ${pair.hidden[0]} ${
          JSON.stringify(pair.hidden[1]).slice(0, 60)
        }`;
        assertEquals(out, missing, where);
        // 오류는 모두 같은 "현재 연결로 읽을 수 없다"다.
        if (out.isError) assertEquals(out.summary, UNREADABLE_MESSAGE, where);
        seen.push(out);
      }
    }
    // 자리 없는 문서도 앱 범위 밖이라 같은 답이다.
    for (
      const [tool, input] of [
        ["lophn_index", { op: "document", reference: refOf(u) }],
        ["lophn_read", { reference: refOf(u) }],
        ["lophn_document", { op: "history", document: u.document }],
      ] as McpCall[]
    ) {
      const out = await world.mcp("appA", tool, input);
      assertEquals(out.isError, true);
      assertEquals(out.summary, UNREADABLE_MESSAGE);
      seen.push(out);
    }
    // 목록·검색·상태·project·root는 읽을 수 있는 것만 담는다.
    const listed = await world.mcp("appA", "lophn_document", { op: "list" });
    assertEquals(
      (listed.data.documents as { document: { id: string } }[]).map((row) =>
        row.document.id
      ),
      [a.document],
    );
    seen.push(listed);
    const search = await world.mcp("appA", "lophn_index", {
      op: "search",
      query: "전용 본문",
    });
    assertEquals(
      (search.data.results as { document: string }[]).map((row) =>
        row.document
      ),
      [a.document],
    );
    seen.push(search);
    const status = await world.mcp("appA", "lophn_index", { op: "status" });
    assertEquals(
      (status.data.documents as { document: string }[]).map((row) =>
        row.document
      ),
      [a.document],
    );
    seen.push(status);
    const projects = await world.mcp("appA", "lophn_project", { op: "list" });
    assertEquals(projects.data.projects, []);
    seen.push(projects);
    const shown = await world.mcp("appA", "lophn_project", {
      op: "show",
      project: world.project,
    });
    const shownAbsent = await world.mcp("appA", "lophn_project", {
      op: "show",
      project: "prj_01arz3ndektsv4rrffq69g5fb9",
    });
    assertEquals(shown, shownAbsent);
    seen.push(shown);
    const root = await world.mcp("appA", "lophn_index", { op: "root" });
    const entries = (root.data.entries as { kind: string; id?: string }[])
      .filter((entry) => entry.kind !== "unplaced");
    assertEquals(entries.map((entry) => `${entry.kind}:${entry.id}`), [
      `app:${world.appA}`,
    ]);
    seen.push({ ...root, data: { ...root.data, entries } });
    // 범위 밖 문서의 제목·본문·ID·판·첨부 이름은 어느 응답에도 없다.
    const text = JSON.stringify(seen);
    for (
      const leaked of [
        "plan-b",
        "plan-p",
        "plan-u",
        "비 계획",
        "프로젝트 계획",
        "자리없음 계획",
        "베타",
        "감마",
        "델타",
        ATTACHMENT,
        b.document,
        b.version,
        p.document,
        p.version,
        u.document,
        u.version,
        world.appB,
        world.project,
      ]
    ) {
      assert(!text.includes(leaked), `범위 밖 값이 새었다: ${leaked}`);
    }
    // 같은 요청을 전체 범위 연결은 읽는다. 막힌 것이 존재 때문이 아니라 범위 때문이다.
    const all = await world.mcp("all", "lophn_read", { reference: refOf(b) });
    assertEquals(all.isError, false, all.summary);
    const allList = await world.mcp("all", "lophn_document", { op: "list" });
    assertEquals((allList.data.documents as unknown[]).length, 4);
  } finally {
    await world.dispose();
  }
});

// CLI가 같은 daemon client로 보내는 읽기다. 입력은 command 표의 schema로 검사하고
// op·공통 field를 떼어 표의 소유 route 하나로 보낸다(cli#R1, R4).
async function cliRead(
  world: ScopeWorld,
  who: Who,
  command: string,
  input: Record<string, unknown>,
): Promise<Result<unknown>> {
  const entry = findCommand(command);
  assert(entry, `command 표에 ${command}이 없다`);
  const checked = entry.input.safeParse({ command, ...input });
  assert(checked.success, JSON.stringify(checked.error?.issues));
  const {
    command: _command,
    json: _json,
    connection: _connection,
    daemon_url: _daemonUrl,
    app: _app,
    base_revision: _baseRevision,
    idempotency_key: _key,
    input: _input,
    input_file: _inputFile,
    op,
    ...rest
  } = checked.data as Record<string, unknown>;
  const route =
    (op === undefined ? entry.monoRoute : entry.opRoutes?.[op as string]) as
      | Route
      | undefined;
  assert(route, `${command} ${op}의 route가 표에 없다`);
  return await world.clientOf(who).read(route, rest);
}

type ParityCase = {
  label: string;
  mcp: McpCall;
  cli: [string, Record<string, unknown>];
  // tool이 route 출력을 다시 모양내는 읽기는 key 비교 대신 이 함수로 같은 사실을 비교한다.
  same?: (mcp: Record<string, unknown>, core: Record<string, unknown>) => void;
};

function parityCases(world: ScopeWorld, s: Setup): ParityCase[] {
  const { a, b, p } = s;
  const placeA = { kind: "app", id: world.appA };
  const placeB = { kind: "app", id: world.appB };
  return [
    {
      label: "index root",
      mcp: ["lophn_index", { op: "root" }],
      cli: ["index", { op: "root" }],
    },
    {
      label: "index place(앱 A)",
      mcp: ["lophn_index", { op: "place", place: placeA }],
      cli: ["index", { op: "place", place: placeA }],
    },
    {
      label: "index place(앱 B)",
      mcp: ["lophn_index", { op: "place", place: placeB }],
      cli: ["index", { op: "place", place: placeB }],
    },
    {
      label: "index document(A 문서)",
      mcp: ["lophn_index", { op: "document", reference: refOf(a) }],
      cli: ["index", { op: "document", reference: refOf(a) }],
    },
    {
      label: "index document(B 문서)",
      mcp: ["lophn_index", { op: "document", reference: refOf(b) }],
      cli: ["index", { op: "document", reference: refOf(b) }],
    },
    {
      label: "read(A 문서)",
      mcp: ["lophn_read", { reference: refOf(a) }],
      cli: ["read", { reference: refOf(a) }],
    },
    {
      label: "read(project 문서)",
      mcp: ["lophn_read", { reference: refOf(p) }],
      cli: ["read", { reference: refOf(p) }],
    },
    {
      label: "document list",
      mcp: ["lophn_document", { op: "list" }],
      cli: ["document list", {}],
    },
    {
      label: "document history(A 문서)",
      mcp: ["lophn_document", { op: "history", document: a.document }],
      cli: ["document history", { document: a.document }],
    },
    {
      label: "document history(B 문서)",
      mcp: ["lophn_document", { op: "history", document: b.document }],
      cli: ["document history", { document: b.document }],
    },
    {
      label: "project list",
      mcp: ["lophn_project", { op: "list" }],
      cli: ["project list", {}],
      same: (mcp, core) =>
        assertEquals(
          (mcp.projects as { id: string }[]).map((project) => project.id),
          (core.projects as { id: string }[]).map((project) => project.id),
        ),
    },
  ];
}

Deno.test("coding-agent/connection#R6 coding-agent/cli#R1: 같은 credential·입력의 읽기는 MCP와 CLI가 같은 route로 보내 같은 결과와 같은 거절을 받는다", async () => {
  const s = await setup();
  const { world } = s;
  try {
    let accepted = 0;
    let rejected = 0;
    for (const who of ["appA", "all"] as const) {
      for (const one of parityCases(world, s)) {
        const mcp = await world.mcp(who, ...one.mcp);
        const cli = await cliRead(world, who, ...one.cli);
        const label = `${who} ${one.label}`;
        if (cli.ok) {
          accepted += 1;
          assertEquals(mcp.isError, false, `${label}: ${mcp.summary}`);
          // MCP data는 route 출력이다. 같은 사실을 두 통로가 낸다.
          const core = cli.value as Record<string, unknown>;
          if (one.same !== undefined) {
            one.same(mcp.data, core);
            continue;
          }
          for (const [key, value] of Object.entries(core)) {
            assertEquals(mcp.data[key], value, `${label}: ${key}`);
          }
        } else {
          rejected += 1;
          assertEquals(mcp.isError, true, label);
          assertEquals(mcp.data.code, cli.error.code, label);
          assertEquals(mcp.summary, cli.error.message, label);
        }
      }
    }
    assert(accepted > 0 && rejected > 0);
    // 전체 범위 연결은 앱 B 자리를 읽고 앱 하나 연결만 같은 요청에 거절된다.
    const place = { kind: "app", id: world.appB };
    const wide = await cliRead(world, "all", "index", { op: "place", place });
    assert(wide.ok);
    const narrow = await cliRead(world, "appA", "index", {
      op: "place",
      place,
    });
    assert(!narrow.ok);
    assertEquals(narrow.error.message, UNREADABLE_MESSAGE);
  } finally {
    await world.dispose();
  }
});

Deno.test("coding-agent/connection#R6 coding-agent/cli#R1: 같은 credential·입력의 저장은 MCP와 CLI가 같은 결과와 같은 거절을 받고 범위 밖 자리에는 저장되지 않는다", async () => {
  const s = await setup();
  const { world } = s;
  try {
    const mcpSave = (who: Who, input: Record<string, unknown>) =>
      world.mcp(who, "lophn_save", input);
    const cliSave = (who: Who, input: Record<string, unknown>) =>
      runSave(
        { command: "save", ...input } as Parameters<typeof runSave>[0],
        world.saveDeps(who),
      );
    await Deno.writeTextFile(`${world.work}/same.md`, "# 같은 저장\n\n본문\n");
    const own = {
      paths: ["same.md"],
      place: { kind: "app", id: world.appA },
      slug: "same",
    };
    // 허용된 저장: CLI가 새 문서를 만들고 MCP는 같은 입력을 새 판 없이 받는다.
    const first = await cliSave("appA", own);
    assert(first.ok, first.ok ? "" : JSON.stringify(first.error));
    const second = await mcpSave("appA", own);
    assertEquals(second.isError, false, second.summary);
    const created = first.value.data as {
      document: string;
      version: string;
      status: string;
    };
    assertEquals(created.status, "saved");
    assertEquals(second.data.status, "unchanged");
    assertEquals(second.data.document, created.document);
    assertEquals(second.data.version, created.version);
    // 거절도 같다: 다른 앱 자리·project 자리·자리 없음.
    const refused: [string, Record<string, unknown>][] = [
      ["다른 앱 자리", {
        paths: ["same.md"],
        place: { kind: "app", id: world.appB },
        slug: "same",
      }],
      ["project 자리", {
        paths: ["same.md"],
        place: { kind: "project", id: world.project },
        slug: "same",
      }],
      ["자리 없음", { paths: ["same.md"] }],
    ];
    for (const [label, input] of refused) {
      const cli = await cliSave("appA", input);
      const mcp = await mcpSave("appA", input);
      assert(!cli.ok, `${label}: CLI가 저장했다`);
      assert(
        cli.error.code === "forbidden" || cli.error.code === "not_found",
        `${label}: ${JSON.stringify(cli.error)}`,
      );
      assertEquals(mcp.isError, true, label);
      assertEquals(mcp.data.code, cli.error.code, label);
      assertEquals(mcp.summary, cli.error.message, label);
    }
    // 거절된 저장은 아무것도 남기지 않는다: 시작 4개와 앱 A의 같은 저장 1개뿐이다.
    const after = await world.mcp("all", "lophn_document", { op: "list" });
    assertEquals((after.data.documents as unknown[]).length, 5);
    // 같은 입력을 전체 범위 연결은 다른 앱 자리에도 저장하고 두 통로가 같은 문서를 가리킨다.
    const wideInput = {
      paths: ["same.md"],
      place: { kind: "app", id: world.appB },
      slug: "same",
    };
    const wide = await mcpSave("all", wideInput);
    assertEquals(wide.isError, false, wide.summary);
    const wideCli = await cliSave("all", wideInput);
    assert(wideCli.ok);
    assertEquals(
      (wideCli.value.data as { document: string }).document,
      wide.data.document,
    );
  } finally {
    await world.dispose();
  }
});

// 요청 하나를 route 종류에 맞는 모양으로 보낸다. 입력이 비어 있어도 권한 검사가 먼저다.
function sendEmpty(world: ScopeWorld, who: string, route: Route) {
  const body = route.kind === "command"
    ? { input: {}, idempotency_key: "k-forbidden", compare: {}, prepared: [] }
    : {};
  return world.post(who, `${route.resource}/${route.method}`, body);
}

Deno.test("coding-agent/mcp-server#R30 coding-agent/mcp-server#R31 coding-agent/cli#R6 coding-agent/cli#R16 coding-agent/cli#R17 coding-agent/cli#R23 coding-agent/cli#R38: 금지 동작을 daemon에 직접 요청해도 거절되고 아무것도 바뀌지 않는다", async () => {
  const s = await setup();
  const { world } = s;
  try {
    const byName = new Map(
      (ALL_ROUTES as Route[]).map((route) => [route.name, route]),
    );
    const names = forbiddenRouteNames();
    // 계약 actor가 coding_agent를 받는 이름 조회 셋은 operation을 열지 않아도 platform이
    // 읽기를 서빙한다(질문 Q31). 이 목록에 없는 금지 route는 모두 거절이어야 한다.
    const ungated = names.filter((name) =>
      byName.get(name)!.actors.includes("coding_agent")
    ).sort();
    assertEquals(ungated, ["GetBackup", "ListBackups", "ListSecrets"]);
    const before = await world.mcp("all", "lophn_document", { op: "list" });
    const beforeProjects = await world.mcp("all", "lophn_project", {
      op: "list",
    });
    // (1) 허용 operation(문서 읽기·저장)만 가진 연결은 금지 route 어디에도 닿지 못한다.
    //     제품 core가 서빙하지 않는 route는 route 자체가 없다.
    for (const who of ["all", "appA", "appB"] as const) {
      for (const name of names.filter((one) => !ungated.includes(one))) {
        const route = byName.get(name);
        assert(route, name);
        const sent = await sendEmpty(world, who, route);
        const error = (sent.body as { error?: { code: string } }).error;
        assert(
          (sent.status === 403 && error?.code === "forbidden") ||
            (sent.status === 404 && error?.code === "not_found"),
          `${who} ${name}: ${sent.status} ${JSON.stringify(sent.body)}`,
        );
      }
    }
    // (2) 금지 route의 operation을 직접 열어 줘도 계약 actor가 coding_agent를 받지 않는
    //     route는 거절이다.
    const granted = await world.addAgent("granted", [
      ...names,
      ...DOCUMENT_OPERATIONS,
    ]);
    for (const name of names.filter((one) => !ungated.includes(one))) {
      const sent = await sendEmpty(world, granted, byName.get(name)!);
      assert(
        sent.status === 403 || sent.status === 404,
        `granted ${name}: ${sent.status} ${JSON.stringify(sent.body)}`,
      );
    }
    // 이름 조회는 값이 없다: 이름·설정 여부·revision뿐이다.
    const secrets = await world.post(granted, "secrets/list", {});
    assertEquals(secrets.status, 200);
    for (
      const entry of (secrets.body as { secrets: Record<string, unknown>[] })
        .secrets
    ) {
      assertEquals(Object.keys(entry).sort(), [
        "configured",
        "name",
        "revision",
      ]);
    }
    // 거절된 요청이 아무것도 만들거나 바꾸지 않았다.
    const after = await world.mcp("all", "lophn_document", { op: "list" });
    assertEquals(after.data.documents, before.data.documents);
    const afterProjects = await world.mcp("all", "lophn_project", {
      op: "list",
    });
    assertEquals(afterProjects.data.projects, beforeProjects.data.projects);
    // 사람 관리 command는 CLI 표에도 없다(실행 전 거절은 cli/forbidden_test.ts).
    assert(COMMANDS.every((entry) => !entry.name.startsWith("secrets")));
  } finally {
    await world.dispose();
  }
});

Deno.test("coding-agent/mcp-server#R30: discovery와 응답 어디에도 운영 data 경로와 token이 없다", async () => {
  const s = await setup();
  const { world } = s;
  try {
    const who3 = ["all", "appA", "appB"] as const;
    const entries = JSON.stringify(toolEntries(["core", "app"]));
    for (const secret of [world.home, ...who3.map((who) => world.token(who))]) {
      assert(!entries.includes(secret));
    }
    const seen: unknown[] = [];
    for (const who of ["all", "appA"] as const) {
      for (const one of parityCases(world, s)) {
        seen.push(await world.mcp(who, ...one.mcp));
      }
    }
    const text = JSON.stringify(seen);
    assert(!text.includes(world.home), "운영 data root 경로가 응답에 있다");
    for (const who of who3) {
      assert(!text.includes(world.token(who)), "token 원문이 응답에 있다");
    }
  } finally {
    await world.dispose();
  }
});

Deno.test("coding-agent/connection#R10: source처럼 보이는 data symlink와 다른 앱 source는 MCP와 CLI 저장에서 없는 파일과 같은 답으로 거절되고 응답에 운영 data 경로가 없다", async () => {
  const s = await setup();
  const { world } = s;
  const outside = await Deno.makeTempDir({ prefix: "lophn-scope-other-app-" });
  try {
    await Deno.mkdir(`${world.home}/documents`, { recursive: true });
    await Deno.writeTextFile(
      `${world.home}/documents/secret.md`,
      "# 운영 문서\n",
    );
    await Deno.writeTextFile(`${outside}/main.ts`, "export {};\n");
    await Deno.symlink(
      `${world.home}/documents/secret.md`,
      `${world.work}/looks-like-source.md`,
    );
    await Deno.symlink(`${outside}/main.ts`, `${world.work}/other-app.ts`);
    const results: { code: string; message: string }[] = [];
    const seen: unknown[] = [];
    for (
      const path of ["looks-like-source.md", "other-app.ts", "nothing.md"]
    ) {
      const input = { paths: [path] };
      const mcp = await world.mcp("all", "lophn_save", input);
      const cli = await runSave(
        { command: "save", ...input } as Parameters<typeof runSave>[0],
        world.saveDeps("all"),
      );
      assertEquals(mcp.isError, true, path);
      assert(!cli.ok, path);
      assertEquals(mcp.data.code, cli.error.code, path);
      assertEquals(mcp.summary, cli.error.message, path);
      results.push({ code: cli.error.code, message: cli.error.message });
      seen.push(mcp, cli.error);
    }
    // 없는 파일(nothing.md)과 같은 거절이다.
    assertEquals(results[0], results[2]);
    assertEquals(results[1], results[2]);
    const text = JSON.stringify(seen);
    assert(!text.includes(world.home), "운영 data 경로가 새었다");
    assert(!text.includes(outside), "다른 앱 source 경로가 새었다");
    // 아무것도 저장되지 않았다.
    const documents = await world.mcp("all", "lophn_document", { op: "list" });
    assertEquals((documents.data.documents as unknown[]).length, 4);
  } finally {
    await world.dispose();
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("coding-agent/connection#R11: 대상 앱을 어떻게 골라도 앱 하나 연결의 범위가 넓어지지 않고 daemon도 같은 범위를 지킨다", async () => {
  const s = await setup();
  const { world } = s;
  try {
    const scope = { kind: "app" as const, app: world.appA };
    for (
      const found of [
        resolveTargetApp({ option: world.appB }),
        resolveTargetApp({ env: world.appB }),
      ]
    ) {
      assert(found.ok);
      const checked = withinScope(found.value, scope);
      assert(!checked.ok);
      assertEquals(checked.error.code, "forbidden");
    }
    // 고른 앱과 무관하게 daemon의 범위는 credential이 정한다: B를 골라도 B의 문서는 닫힌다.
    const hidden = await world.mcp("appA", "lophn_read", {
      reference: refOf(s.b),
    });
    assertEquals(hidden.isError, true);
    assertEquals(hidden.summary, UNREADABLE_MESSAGE);
    const own = resolveTargetApp({ option: world.appA });
    assert(own.ok);
    assert(withinScope(own.value, scope).ok);
    const readable = await world.mcp("appA", "lophn_read", {
      reference: refOf(s.a),
    });
    assertEquals(readable.isError, false, readable.summary);
  } finally {
    await world.dispose();
  }
});
