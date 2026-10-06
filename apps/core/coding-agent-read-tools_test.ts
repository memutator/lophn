// coding-agent#T13 끝에서 끝까지: coding agent가 MCP tool(`lophn_index`·`lophn_project`·
// `lophn_document`·`lophn_read`)로 목차→구역→본문, project, 목록, 이력·diff를 읽는다.
// core, documents worker(format 검사), I/O worker(blob 준비)는 실제 자식 프로세스이고 판은
// coding agent가 실제 upload·prepare·save로 쌓는다. 추출 결과는 실제 document format module이
// 만든 구역·본문을 파생 store에 심는다(consumer 조립은 documents#T21). tools/call은 실제
// MCP handler를 지나므로 입력 검사·isError가 그대로 응답에 닿는다. 데이터 root·작업 폴더는
// temp dir이고 사람 데이터 root는 열지 않는다.
import { createHash } from "node:crypto";
import { assert, assertEquals } from "@std/assert";
import { manualClock, ok, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { createCoreClient } from "../../packages/coding-agent/connection/client/core.ts";
import {
  saveFromPaths,
  uploadPrepareBytes,
} from "../../packages/coding-agent/connection/mod.ts";
import { createHandler } from "../../packages/coding-agent/mcp-server/server.ts";
import { resolveRoute } from "../../packages/coding-agent/mcp-server/registry.ts";
import { createDocumentTool } from "../../packages/coding-agent/mcp-server/tools/document.ts";
import { createIndexTool } from "../../packages/coding-agent/mcp-server/tools/index.ts";
import { createProjectTool } from "../../packages/coding-agent/mcp-server/tools/project.ts";
import { createReadTool } from "../../packages/coding-agent/mcp-server/tools/read.ts";
import { extractFormat } from "../../packages/documents/formats/guest.ts";
import {
  derivedPath,
  type DerivedStore,
  openDerived,
} from "../../packages/documents/outline-and-search/adapters/store.ts";
import {
  type ExtractionRecord,
  recordExtraction,
} from "../../packages/documents/outline-and-search/extraction.ts";
import { type Core, startCore } from "./core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";
import { lophnAgentDefinitions } from "./lophn-agent.ts";
import { createLedgerRegistration as createAppsRegistration } from "./apps.ts";
import { closeUnlessKept } from "./testing/close-on-throw.ts";

const teams: TeamModule[] = [
  { lophnAgentDefinitions },
  { createLedgerRegistration },
  { createLedgerRegistration: createAppsRegistration },
];
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const CAC_LIMITED = "cac_01arz3ndektsv4rrffq69g5faw";
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const PLACE = { kind: "project" as const, id: PROJECT };
const ABSENT = "doc_01arz3ndektsv4rrffq69g5fb9";
const AGENT_TOKEN = "a".repeat(43);
const OUTSIDE_TOKEN = "c".repeat(43);
const USER_TOKEN = "b".repeat(43);
const LIMITED_TOKEN = "d".repeat(43);
const AGENT_OPERATIONS = [
  "document.upload",
  "document.prepare",
  "document.save",
  "document.list",
  "document.get",
  "document.history",
  "document.read",
  "document.section_history",
  "document.diff",
  "outline.root",
  "outline.place",
  "outline.document",
  "search.query",
  "search.status",
  "project.list",
  "project.get",
  "project.resolve_cwd",
];

type Opened = {
  core: Core;
  home: string;
  work: string;
  store: DerivedStore;
  call(
    token: "agent" | "outside" | "limited",
    name: string,
    args: Record<string, unknown>,
  ): Promise<Reply>;
  dispose(): Promise<void>;
};

type Reply = {
  isError: boolean;
  summary: string;
  data: Record<string, unknown>;
  next: string[];
};

async function open(): Promise<Opened> {
  const home = await Deno.makeTempDir({ prefix: "lophn-read-tools-" });
  const work = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-read-tools-work-" }),
  );
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams,
    teamModules: [
      new URL("./lophn-agent.ts", import.meta.url).href,
      new URL("./documents.ts", import.meta.url).href,
      new URL("./apps.ts", import.meta.url).href,
    ],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(61),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  await using guard = closeUnlessKept(async () => {
    await started.value.shutdown();
    await Deno.remove(home, { recursive: true });
    await Deno.remove(work, { recursive: true });
  });
  const core = started.value;
  const agent = (
    cac: string,
    credential: string,
    targets: Record<string, string>,
    cwd?: string,
  ): AuthenticatedContext => ({
    principal: `coding_agent:${cac}`,
    actor: `coding_agent:${cac}`,
    scope: { operations: AGENT_OPERATIONS, targets },
    conditions: cwd === undefined ? {} : { cwd },
    credential_ref: credential,
  });
  const contexts: [AuthenticatedContext, string][] = [
    [agent(CAC, "cred-agent", {}, `${work}/project-folder/src`), AGENT_TOKEN],
    // 어느 등록 폴더에도 속하지 않는 작업 위치다.
    [agent(CAC, "cred-outside", {}, `${work}/elsewhere`), OUTSIDE_TOKEN],
    [{
      principal: "user",
      actor: "user",
      scope: { operations: ["project.create"], targets: {} },
      conditions: {},
      credential_ref: "cred-user",
    }, USER_TOKEN],
  ];
  for (const [context, token] of contexts) {
    const accepted = await core.acceptTestCredential?.(context, token);
    assert(accepted?.ok);
    const recorded = await core.record(context);
    assert(recorded.ok);
  }
  await Deno.mkdir(`${home}/derived`, { recursive: true });
  const store = openDerived(derivedPath(`${home}/derived`));
  assert(store.ok, store.ok ? "" : store.error.message);
  const clientOf = (token: string) =>
    createCoreClient({
      baseUrl: `http://127.0.0.1:${core.port}`,
      connection: CAC,
      provider: () => Promise.resolve({ ok: true, value: { token } }),
    });
  const handlers = new Map<string, ReturnType<typeof createHandler>>();
  function handlerFor(token: string, limited: boolean) {
    const key = `${token}-${limited}`;
    const existing = handlers.get(key);
    if (existing !== undefined) return existing;
    const client = clientOf(token);
    const tools = {
      lophn_index: createIndexTool({ client }),
      lophn_project: createProjectTool({ client }),
      lophn_document: createDocumentTool({ client }),
      lophn_read: createReadTool({ client }),
    };
    const handler = createHandler({
      callTool: (name, args) => {
        const op = (args as { op?: string }).op;
        const resolved = resolveRoute(name, op);
        assert(resolved, `route ${name} ${op}`);
        const run = tools[name as keyof typeof tools];
        return run(name, resolved.route, args);
      },
    });
    handlers.set(key, handler);
    return handler;
  }
  let id = 0;
  guard.keep();
  return {
    core,
    home,
    work,
    store: store.value,
    async call(who, name, args) {
      const token = who === "agent"
        ? AGENT_TOKEN
        : who === "outside"
        ? OUTSIDE_TOKEN
        : LIMITED_TOKEN;
      id += 1;
      const response = await handlerFor(token, who === "limited")(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      );
      assert(response !== undefined);
      assertEquals(response.error, undefined, JSON.stringify(response));
      const result = response.result as {
        isError?: boolean;
        structuredContent: { summary: string; data: unknown; next: string[] };
        content: { text: string }[];
      };
      // 두 표현이 같은 사실이다.
      assertEquals(
        JSON.parse(result.content[0].text),
        result.structuredContent,
      );
      return {
        isError: result.isError === true,
        summary: result.structuredContent.summary,
        data: result.structuredContent.data as Record<string, unknown>,
        next: result.structuredContent.next,
      };
    },
    async dispose() {
      store.value.close();
      await core.shutdown();
      await Deno.remove(home, { recursive: true });
      await Deno.remove(work, { recursive: true });
    },
  };
}

async function postUser(
  opened: Opened,
  path: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `http://127.0.0.1:${opened.core.port}/v1/${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${USER_TOKEN}`,
      },
      body: JSON.stringify(body),
    },
  );
  const text = await response.text();
  assertEquals(response.status, 200, `${path}: ${text}`);
  return JSON.parse(text) as Record<string, unknown>;
}

async function createProject(opened: Opened) {
  await postUser(opened, "projects/create", {
    input: {
      id: PROJECT,
      name: "mahas",
      title: "Notes",
      purpose: "작업 기록",
      folders: [{
        path: `${opened.work}/project-folder`,
        description: "비공개 폴더 설명",
      }],
      tracking: {
        enabled: false,
        patterns: [{ effect: "exclude", glob: "secret-rule/**" }],
        use_gitignore: false,
      },
    },
    idempotency_key: "project-1",
    compare: {},
    prepared: [],
  });
}

type Saved = { document: string; version: string; text: string };

// coding agent가 파일을 실제 upload·prepare·save로 저장한다. 같은 자리·slug는 같은 문서다.
async function save(
  opened: Opened,
  slug: string,
  text: string,
  place: typeof PLACE | null = PLACE,
): Promise<Saved> {
  await Deno.writeTextFile(`${opened.work}/${slug}.md`, text);
  const client = createCoreClient({
    baseUrl: `http://127.0.0.1:${opened.core.port}`,
    connection: CAC,
    provider: () =>
      Promise.resolve({ ok: true, value: { token: AGENT_TOKEN } }),
  });
  const saved = await saveFromPaths(
    {
      client,
      scope: { root: opened.work, forbidden: [opened.home] },
      prepareBytes: uploadPrepareBytes(client),
    },
    { paths: [`${slug}.md`], ...(place ? { place, slug } : {}) },
  );
  assert(saved.ok, saved.ok ? "" : JSON.stringify(saved.error));
  return {
    document: saved.value.saved.document,
    version: saved.value.saved.version,
    text,
  };
}

// 실제 document format module이 낸 구역·본문을 파생 store에 심는다. unverified는
// consumer가 확인하지 못한 판처럼 구역 없이 그 상태만 심는다.
async function extract(
  opened: Opened,
  saved: Saved,
  slug: string,
  status: "ready" | "unverified" = "ready",
): Promise<void> {
  const fixed = await postUser2(opened, "documents/get", {
    document: saved.document,
    version: saved.version,
  });
  const version = fixed.version as {
    content_hash: string;
    format: { module_hash: string };
  };
  const bytes = new TextEncoder().encode(saved.text);
  const result = extractFormat("document", {
    input_hash: createHash("sha256").update(bytes).digest("hex"),
    module_hash: version.format.module_hash,
    files: [{
      path: `${slug}.md`,
      media_type: "text/markdown",
      primary: true,
      content: Array.from(bytes),
    }],
  });
  assertEquals(result.status, "ready");
  if (result.status !== "ready") return;
  const record: ExtractionRecord = {
    document: saved.document,
    version: saved.version,
    content_hash: version.content_hash,
    module_hash: version.format.module_hash,
    extraction: status === "ready"
      ? {
        status: "ready",
        title: result.title ?? undefined,
        text: result.text,
        text_hash: result.text_hash,
        sections: result.sections,
      }
      : { status: "unverified" },
  };
  const written = recordExtraction(opened.store, record, "1");
  assert(written.ok, written.ok ? "" : written.error.message);
}

// 사람의 읽기 자격이 없어 agent 자격으로 문서 metadata를 읽는다.
async function postUser2(
  opened: Opened,
  path: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `http://127.0.0.1:${opened.core.port}/v1/${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${AGENT_TOKEN}`,
      },
      body: JSON.stringify(body),
    },
  );
  const text = await response.text();
  assertEquals(response.status, 200, `${path}: ${text}`);
  return JSON.parse(text) as Record<string, unknown>;
}

// derived consumer가 장부 끝까지 처리했다고 표시한다. 표시하지 않으면 반영 지연이다.
async function markIndexed(opened: Opened): Promise<void> {
  const basis = await postUser2(opened, "documents/list", {});
  const seq = String(basis.as_of_seq);
  const cursor = opened.store.transaction((tx) =>
    ok(tx.sql.run(
      `INSERT OR REPLACE INTO derived_cursors (consumer, processed_seq, rebuilding) VALUES ('search', ?, 0)`,
      [seq],
    ))
  );
  assert(cursor.ok);
}

const V1 = "# 계획서\n\n## 개요\n그대로 두는 개요\n\n## 계획\n처음 계획\n";
const V2 =
  "# 계획서\n\n## 개요\n그대로 두는 개요\n\n## 계획\n고친 계획\n첫 보강\n";
const LONG = `# 긴 문서\n\n## 본문\n${"가나다라마바사아자차\n".repeat(60)}`;

Deno.test("coding-agent/mcp-server#R8, coding-agent/mcp-server#R10: 실제 core에서 전체 목차→자리 목차→문서 목차→구역→본문과 keyword 검색이 고정 판으로 이어진다", async () => {
  const opened = await open();
  try {
    await createProject(opened);
    const plan = await save(opened, "plan", V1);
    await extract(opened, plan, "plan");
    await markIndexed(opened);

    const root = await opened.call("agent", "lophn_index", { op: "root" });
    assertEquals(root.isError, false, root.summary);
    const entries = root.data.entries as { kind: string; id?: string }[];
    assert(entries.some((entry) => entry.kind === "project"));

    const place = await opened.call("agent", "lophn_index", {
      op: "place",
      place: PLACE,
    });
    assertEquals(place.isError, false, place.summary);
    assert(place.summary.includes("자리 문서 1개"), place.summary);
    // 반영이 끝났으니 지연 안내가 없다.
    assertEquals(place.summary.includes("반영 지연"), false, place.summary);

    const document = await opened.call("agent", "lophn_index", {
      op: "document",
      reference: {
        document: plan.document,
        version: plan.version,
        section: null,
      },
    });
    assertEquals(document.isError, false, document.summary);
    const sections = (document.data.entries as { key: string }[]).map((
      entry,
    ) => entry.key);
    assert(sections.includes("계획"), JSON.stringify(sections));

    const section = await opened.call("agent", "lophn_index", {
      op: "section",
      reference: {
        document: plan.document,
        version: plan.version,
        section: "계획",
      },
    });
    assertEquals(section.isError, false, section.summary);

    // 구역 없는 section op는 문서 목차로 추측하지 않고 실행 전 거절한다.
    const noSection = await opened.call("agent", "lophn_index", {
      op: "section",
      reference: {
        document: plan.document,
        version: plan.version,
        section: null,
      },
    });
    assertEquals(noSection.isError, true);
    assert(noSection.summary.includes("reference.section"), noSection.summary);

    const read = await opened.call("agent", "lophn_read", {
      reference: {
        document: plan.document,
        version: plan.version,
        section: null,
      },
      section: "계획",
    });
    assertEquals(read.isError, false, read.summary);
    assert((read.data.text as string).includes("처음 계획"));
    assertEquals(read.data.complete, true);
    assert(read.summary.includes("끝까지 읽었다"), read.summary);

    const search = await opened.call("agent", "lophn_index", {
      op: "search",
      query: "계획서",
    });
    assertEquals(search.isError, false, search.summary);
    const results = search.data.results as {
      document: string;
      reference: { document: string; version: string };
    }[];
    assertEquals(results.map((result) => result.document), [plan.document]);
    // 결과의 reference로 그대로 본문을 읽는다.
    const viaSearch = await opened.call("agent", "lophn_read", {
      reference: {
        ...results[0].reference,
        section: (results[0].reference as { section?: string | null })
          .section ?? null,
      },
    });
    assertEquals(viaSearch.isError, false, viaSearch.summary);

    const status = await opened.call("agent", "lophn_index", { op: "status" });
    assertEquals(status.isError, false, status.summary);
    assertEquals((status.data.documents as unknown[]).length, 1);
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/mcp-server#R8: derived가 장부를 따라오지 못하면 검색·상태 요약이 반영 지연을 밝히고 빈 결과를 완전한 답으로 내지 않는다", async () => {
  const opened = await open();
  try {
    await createProject(opened);
    const plan = await save(opened, "plan", V1);
    await extract(opened, plan, "plan");
    // markIndexed를 하지 않는다: 처리한 seq가 장부보다 뒤처진다.
    const search = await opened.call("agent", "lophn_index", {
      op: "search",
      query: "존재하지 않는 낱말입니다",
    });
    assertEquals(search.isError, false, search.summary);
    assertEquals(
      (search.data.coverage as { lagging: boolean }).lagging,
      true,
    );
    assert(search.summary.includes("반영 지연"), search.summary);
    assert(search.summary.includes("없다는 뜻이 아니다"), search.summary);
    const status = await opened.call("agent", "lophn_index", { op: "status" });
    assert(status.summary.includes("반영 지연"), status.summary);
    // status에는 이어 읽기 cursor가 없다. 넣으면 실행 전 거절이다.
    const cursor = await opened.call("agent", "lophn_index", {
      op: "status",
      cursor: "x",
    });
    assertEquals(cursor.isError, true);
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/mcp-server#R10: 읽는 중 새 판이 생겨도 원래 판을 이어 읽고 새 판 존재를 알리며 틀린 cursor와 범위는 거절한다", async () => {
  const opened = await open();
  try {
    await createProject(opened);
    const first = await save(opened, "long", LONG);
    await extract(opened, first, "long");
    await markIndexed(opened);
    const reference = {
      document: first.document,
      version: first.version,
      section: null,
    };
    const head = await opened.call("agent", "lophn_read", {
      reference,
      max_codepoints: 120,
    });
    assertEquals(head.isError, false, head.summary);
    assertEquals(head.data.complete, false);
    const cursor = head.data.next_cursor as string;
    assert(head.summary.includes("이어 읽을 범위"), head.summary);
    assert(head.next[0].includes("새 판이 생겨도"), head.next[0]);

    // 읽는 사이 새 판을 저장한다.
    const second = await save(opened, "long", `${LONG}덧붙임\n`);
    assertEquals(second.document, first.document);
    await extract(opened, second, "long");

    const tail = await opened.call("agent", "lophn_read", {
      reference,
      max_codepoints: 120,
      cursor,
    });
    assertEquals(tail.isError, false, tail.summary);
    // 같은 판을 이어 읽었고 최신 판이 따로 있음을 알린다.
    assertEquals(tail.data.version, first.version);
    assertEquals(tail.data.latest_version, second.version);
    assert(tail.summary.includes("새 판"), tail.summary);
    assert(tail.summary.includes(second.version), tail.summary);
    assertEquals(
      (tail.data.text as string).includes("덧붙임"),
      false,
    );

    // 다른 범위의 cursor는 거절한다. 다른 판으로 읽어 섞지 않는다.
    const mixed = await opened.call("agent", "lophn_read", {
      reference: { ...reference, version: second.version },
      max_codepoints: 120,
      cursor,
    });
    assertEquals(mixed.isError, true);
    // 틀린 범위(끝이 시작보다 앞)는 실행 전 거절이다.
    const badRange = await opened.call("agent", "lophn_read", {
      reference,
      ranges: [{ start_line: 5, end_line: 2 }],
    });
    assertEquals(badRange.isError, true);
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/mcp-server#R10: 없는 문서와 권한 밖 문서는 같은 not_found이고 추출하지 못한 판은 오류가 아닌 결과로 원문 파일 참조를 낸다", async () => {
  const opened = await open();
  try {
    await createProject(opened);
    const plan = await save(opened, "plan", V1);
    await extract(opened, plan, "plan");
    const unreadable = await save(opened, "raw", V1);
    await extract(opened, unreadable, "raw", "unverified");
    await markIndexed(opened);

    const absent = await opened.call("agent", "lophn_read", {
      reference: { document: ABSENT, version: plan.version, section: null },
    });
    assertEquals(absent.isError, true);
    assertEquals(absent.data.code, "not_found");

    const fallback = await opened.call("agent", "lophn_read", {
      reference: {
        document: unreadable.document,
        version: unreadable.version,
        section: null,
      },
    });
    // 문서가 없는 것이 아니다: 오류가 아니고 이유와 원문 파일을 낸다.
    assertEquals(fallback.isError, false, fallback.summary);
    assertEquals(fallback.data.section_status, "unverified");
    assert(fallback.data.file !== null);
    assert(fallback.summary.includes("없는 문서가 아니다"), fallback.summary);
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/mcp-server#R9: 실제 core에서 project 목록·상세는 이름·목적·읽을 자료만 내고 절대 경로·폴더·tracking 규칙을 내지 않으며 current는 cwd의 project 참조 하나다", async () => {
  const opened = await open();
  try {
    await createProject(opened);
    await save(opened, "plan", V1);

    const list = await opened.call("agent", "lophn_project", { op: "list" });
    assertEquals(list.isError, false, list.summary);
    const projects = list.data.projects as {
      id: string;
      title: string;
      document_count: number;
    }[];
    assertEquals(projects.map((project) => project.id), [PROJECT]);

    const show = await opened.call("agent", "lophn_project", {
      op: "show",
      project: PROJECT,
    });
    assertEquals(show.isError, false, show.summary);
    const project = show.data.project as Record<string, unknown>;
    assertEquals(project.name, "mahas");
    assertEquals(project.purpose, "작업 기록");
    assertEquals(project.document_count, 1);
    for (const reply of [list, show]) {
      const text = JSON.stringify(reply);
      assertEquals(text.includes(opened.work), false, "절대 경로");
      assertEquals(text.includes("비공개 폴더 설명"), false, "폴더 설명");
      assertEquals(text.includes("secret-rule"), false, "tracking 규칙");
      assertEquals(text.includes("folders"), false);
      assertEquals(text.includes("tracking"), false);
    }

    const current = await opened.call("agent", "lophn_project", {
      op: "current",
    });
    assertEquals(current.isError, false, current.summary);
    assertEquals(current.data.projects, [{ project: PROJECT }]);
    // cwd는 입력이 아니다. 주면 실행 전 거절이다.
    const spoof = await opened.call("agent", "lophn_project", {
      op: "current",
      cwd: "/somewhere",
    });
    assertEquals(spoof.isError, true);

    // 어느 등록 폴더에도 속하지 않으면 오류가 아니라 빈 목록과 사람 등록 안내다.
    const outside = await opened.call("outside", "lophn_project", {
      op: "current",
    });
    assertEquals(outside.isError, false, outside.summary);
    assertEquals(outside.data.projects, []);
    assert(String(outside.data.guide).includes("사람이 한다"));
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/mcp-server#R11: 실제 core에서 문서 목록은 본문 없이 자리·자리 없음·상태별로 읽히고 limit로 끊어도 누락·중복 없이 이어진다", async () => {
  const opened = await open();
  try {
    await createProject(opened);
    const a = await save(opened, "a", "# A\n");
    const b = await save(opened, "b", "# B\n");
    const c = await save(opened, "c", "# C\n");
    const loose = await save(opened, "loose", "# 자리 없음\n", null);

    const all: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await opened.call("agent", "lophn_document", {
        op: "list",
        place: PLACE,
        limit: 2,
        ...(cursor === undefined ? {} : { cursor }),
      });
      assertEquals(page.isError, false, page.summary);
      const docs = page.data.documents as { document: { id: string } }[];
      all.push(...docs.map((row) => row.document.id));
      assertEquals(JSON.stringify(page.data).includes("# A"), false);
      cursor = (page.data.next_cursor as string | null) ?? undefined;
      if (cursor !== undefined) {
        assert(page.summary.includes("이어 읽을 것이 더 있다"), page.summary);
      }
      pages += 1;
    } while (cursor !== undefined && pages < 10);
    assertEquals(pages, 2);
    assertEquals(new Set(all).size, 3);
    assertEquals(
      new Set(all),
      new Set([a.document, b.document, c.document]),
    );

    const unplaced = await opened.call("agent", "lophn_document", {
      op: "list",
      unplaced: true,
    });
    assertEquals(unplaced.isError, false, unplaced.summary);
    assertEquals(
      (unplaced.data.documents as { document: { id: string } }[]).map((row) =>
        row.document.id
      ),
      [loose.document],
    );

    // 자리와 자리 없음을 같이 고르거나 한도를 넘기면 실행 전 거절이다.
    for (
      const args of [
        { op: "list", place: PLACE, unplaced: true },
        { op: "list", limit: 501 },
        { op: "list", limit: 0 },
      ]
    ) {
      const bad = await opened.call("agent", "lophn_document", args);
      assertEquals(bad.isError, true, JSON.stringify(args));
    }

    const archived = await opened.call("agent", "lophn_document", {
      op: "list",
      status: "archived",
    });
    assertEquals(archived.isError, false, archived.summary);
    assertEquals(archived.data.documents, []);
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/mcp-server#R12: 실제 core에서 이력은 고정 판 목록과 구역 판별 변화를, diff는 두 판의 줄 차이를 내고 복원하지 못한 판은 누락으로 밝히며 rename을 추정하지 않는다", async () => {
  const opened = await open();
  try {
    await createProject(opened);
    const one = await save(opened, "plan", V1);
    const two = await save(opened, "plan", V2);
    await extract(opened, one, "plan");
    await extract(opened, two, "plan");
    await markIndexed(opened);

    const versions = await opened.call("agent", "lophn_document", {
      op: "history",
      document: one.document,
    });
    assertEquals(versions.isError, false, versions.summary);
    assertEquals((versions.data.versions as unknown[]).length, 2);

    const sectionHistory = await opened.call("agent", "lophn_document", {
      op: "history",
      document: one.document,
      section: "계획",
    });
    assertEquals(sectionHistory.isError, false, sectionHistory.summary);
    assertEquals(
      (sectionHistory.data.entries as { status: string }[]).map((entry) =>
        entry.status
      ),
      ["added", "modified"],
    );
    assert(
      sectionHistory.summary.includes("본문 변경 1"),
      sectionHistory.summary,
    );
    assert(sectionHistory.summary.includes("rename 추정"));

    const diff = await opened.call("agent", "lophn_document", {
      op: "diff",
      document: one.document,
      before: one.version,
      after: two.version,
    });
    assertEquals(diff.isError, false, diff.summary);
    assertEquals(
      (diff.data.deletions as { text: string }[]).map((item) => item.text),
      ["처음 계획"],
    );
    assertEquals(
      (diff.data.additions as { text: string }[]).map((item) => item.text),
      ["고친 계획\n첫 보강"],
    );
    assert(diff.summary.includes("추가 1곳, 삭제 1곳"), diff.summary);

    // 같은 판끼리는 변경 없음이다.
    const same = await opened.call("agent", "lophn_document", {
      op: "diff",
      document: one.document,
      before: two.version,
      after: two.version,
    });
    assertEquals(same.isError, false, same.summary);
    assert(same.summary.includes("변경 없음"), same.summary);

    // 본문을 복원하지 못한 판은 추정하지 않고 누락으로 밝힌다.
    const three = await save(opened, "plan", `${V2}셋째\n`);
    await extract(opened, three, "plan", "unverified");
    const missing = await opened.call("agent", "lophn_document", {
      op: "diff",
      document: one.document,
      before: two.version,
      after: three.version,
    });
    assertEquals(missing.isError, false, missing.summary);
    assertEquals(
      (missing.data.omissions as { version: string }[]).map((item) =>
        item.version
      ),
      [three.version],
    );
    assert(missing.summary.includes("비교하지 못한 곳 1개"), missing.summary);

    // 한쪽 판만 주면 실행 전 거절이다.
    const half = await opened.call("agent", "lophn_document", {
      op: "diff",
      document: one.document,
      before: one.version,
    });
    assertEquals(half.isError, true);
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/mcp-server#R7, coding-agent/mcp-server#R8: 범위 밖 문서는 없는 문서와 같은 답이고 isError가 응답에 닿는다", async () => {
  const opened = await open();
  try {
    await createProject(opened);
    const plan = await save(opened, "plan", V1);
    const other = await save(opened, "other", V1);
    await extract(opened, plan, "plan");
    await extract(opened, other, "other");
    await markIndexed(opened);
    // 다른 문서 하나만 닿는 coding agent 자격을 늦게 등록한다.
    const limited: AuthenticatedContext = {
      principal: `coding_agent:${CAC_LIMITED}`,
      actor: `coding_agent:${CAC_LIMITED}`,
      scope: {
        operations: AGENT_OPERATIONS,
        targets: { document: other.document },
      },
      conditions: {},
      credential_ref: "cred-limited",
    };
    const accepted = await opened.core.acceptTestCredential?.(
      limited,
      LIMITED_TOKEN,
    );
    assert(accepted?.ok);
    assert((await opened.core.record(limited)).ok);

    const hidden = await opened.call("limited", "lophn_index", {
      op: "document",
      reference: {
        document: plan.document,
        version: plan.version,
        section: null,
      },
    });
    const missing = await opened.call("limited", "lophn_index", {
      op: "document",
      reference: { document: ABSENT, version: plan.version, section: null },
    });
    assertEquals(hidden.isError, true);
    assertEquals(hidden.summary, missing.summary);
    assertEquals(hidden.data, missing.data);

    // 허용 밖 문서는 목록에서 빠지고 개수도 새지 않는다.
    const listed = await opened.call("limited", "lophn_document", {
      op: "list",
    });
    assertEquals(listed.isError, false, listed.summary);
    assertEquals(
      (listed.data.documents as { document: { id: string } }[]).map((row) =>
        row.document.id
      ),
      [other.document],
    );
    // 허용 밖 문서의 이력도 없는 문서와 같다.
    const history = await opened.call("limited", "lophn_document", {
      op: "history",
      document: plan.document,
      section: "계획",
    });
    const absentHistory = await opened.call("limited", "lophn_document", {
      op: "history",
      document: ABSENT,
      section: "계획",
    });
    assertEquals(history.isError, true);
    assertEquals(history.summary, absentHistory.summary);
    assertEquals(history.data, absentHistory.data);
  } finally {
    await opened.dispose();
  }
});
