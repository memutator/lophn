// coding-agent#T14 끝에서 끝까지: coding agent가 제출 root의 파일을 `saveFromPaths`·MCP
// `lophn_save`로 저장한다. core, documents worker(format 검사), I/O worker(blob 준비)는
// 모두 실제 자식 프로세스이고 데이터 root는 temp dir다. 사람 데이터 root는 열지 않는다.
// 바이트는 upload route로 가고, 준비·저장·series 가입은 실제 route를 지난다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { createCoreClient } from "../../packages/coding-agent/connection/client/core.ts";
import {
  saveFromPaths,
  uploadPrepareBytes,
} from "../../packages/coding-agent/connection/mod.ts";
import { createSaveTool } from "../../packages/coding-agent/mcp-server/tools/save.ts";
import { createFormatTool } from "../../packages/coding-agent/mcp-server/tools/format.ts";
import { createSeriesTool } from "../../packages/coding-agent/mcp-server/tools/series.ts";
import { resolveRoute } from "../../packages/coding-agent/mcp-server/registry.ts";
import { type Core, startCore } from "./core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";
import { lophnAgentDefinitions } from "./lophn-agent.ts";

const teams: TeamModule[] = [
  { lophnAgentDefinitions },
  { createLedgerRegistration },
];
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const SERIES = "ser_01arz3ndektsv4rrffq69g5fav";
const PLACE = { kind: "project" as const, id: PROJECT };
const AGENT_TOKEN = "a".repeat(43);
const USER_TOKEN = "b".repeat(43);

type Opened = {
  core: Core;
  home: string;
  work: string;
  scope: { root: string; forbidden: string[] };
  dispose(): Promise<void>;
};

async function open(): Promise<Opened> {
  const home = await Deno.makeTempDir({ prefix: "lophn-save-e2e-" });
  const work = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-save-e2e-work-" }),
  );
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams,
    teamModules: [
      new URL("./lophn-agent.ts", import.meta.url).href,
      new URL("./documents.ts", import.meta.url).href,
    ],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(21),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  const contexts: [AuthenticatedContext, string][] = [
    [{
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
          "format.list",
          "format.get",
          "format.validate",
          "series.list",
          "series.get",
          "series.next",
          "series.add_instance",
        ],
        targets: {},
      },
      conditions: {},
      credential_ref: "cred-agent",
    }, AGENT_TOKEN],
    [{
      principal: "user",
      actor: "user",
      scope: {
        operations: ["project.create", "series.create", "document.history"],
        targets: {},
      },
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
  return {
    core,
    home,
    work,
    scope: { root: work, forbidden: [home] },
    async dispose() {
      await core.shutdown();
      await Deno.remove(home, { recursive: true });
      await Deno.remove(work, { recursive: true });
    },
  };
}

function agent(opened: Opened) {
  const client = createCoreClient({
    baseUrl: `http://127.0.0.1:${opened.core.port}`,
    connection: CAC,
    provider: () =>
      Promise.resolve({ ok: true, value: { token: AGENT_TOKEN } }),
  });
  return {
    client,
    deps: {
      client,
      scope: opened.scope,
      prepareBytes: uploadPrepareBytes(client),
    },
  };
}

async function post(
  opened: Opened,
  path: string,
  body: unknown,
  token = USER_TOKEN,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `http://127.0.0.1:${opened.core.port}/v1/${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
  );
  const text = await response.text();
  assertEquals(response.status, 200, `${path}: ${text}`);
  return JSON.parse(text) as Record<string, unknown>;
}

async function blobCount(home: string): Promise<number> {
  let count = 0;
  async function walk(dir: string) {
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isDirectory) await walk(`${dir}/${entry.name}`);
        else count += 1;
      }
    } catch { /* 아직 없다 */ }
  }
  await walk(`${home}/blobs/sha256`);
  return count;
}

async function createProject(opened: Opened) {
  await post(opened, "projects/create", {
    input: {
      id: PROJECT,
      name: "mahas",
      title: "Notes",
      purpose: "",
      folders: [{ path: `${opened.work}/project-folder`, description: "" }],
      tracking: { enabled: false, patterns: [], use_gitignore: false },
    },
    idempotency_key: "project-1",
    compare: {},
    prepared: [],
  });
}

Deno.test("coding-agent/mcp-server#R13 #R15: 자리 없는 저장은 실제 core와 worker를 지나 고정 주소로 다시 읽히고 같은 요청의 재전송은 새 판을 만들지 않는다", async () => {
  const opened = await open();
  try {
    await Deno.mkdir(`${opened.work}/notes`);
    await Deno.writeTextFile(`${opened.work}/notes/plan.md`, "# 계획\n본문\n");
    await Deno.writeTextFile(`${opened.work}/notes/extra.txt`, "첨부");
    const { client, deps } = agent(opened);
    const first = await saveFromPaths(deps, {
      paths: ["notes/plan.md", "notes/extra.txt"],
    });
    assert(first.ok, first.ok ? "" : JSON.stringify(first.error));
    assertEquals(first.value.saved.status, "saved");
    assertEquals(first.value.placed, false);
    const document = first.value.saved.document;
    // 고정 주소로 다시 읽으면 두 파일과 primary가 그대로다.
    const got = await client.read(
      (await import("../../packages/contracts/documents/mod.ts")).documentGet,
      { document, version: first.value.saved.version },
    );
    assert(got.ok, got.ok ? "" : JSON.stringify(got.error));
    const version = (got.value as {
      version: { number: number; files: unknown };
    }).version;
    assertEquals(version.number, 1);
    // 파일 목록(두 파일, 첫 파일 primary)은 목록 blob에 있다. 두 파일과 목록이 설치됐다.
    const blobsAfterFirst = await blobCount(opened.home);
    assert(blobsAfterFirst >= 3, "두 파일과 목록 blob이 설치됐다");
    // 같은 요청의 재전송은 같은 문서·판이고 새 판이 없다.
    const again = await saveFromPaths(deps, {
      paths: ["notes/plan.md", "notes/extra.txt"],
    });
    assert(again.ok, again.ok ? "" : JSON.stringify(again.error));
    assertEquals(again.value.saved.document, document);
    assertEquals(again.value.saved.version, first.value.saved.version);
    const history = await post(opened, "documents/history", { document });
    assertEquals((history.versions as unknown[]).length, 1);
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/mcp-server#R13: 자리 있는 저장의 재전송은 unchanged이고 바뀐 내용은 새 판이다", async () => {
  const opened = await open();
  try {
    await createProject(opened);
    const { deps } = agent(opened);
    await Deno.writeTextFile(`${opened.work}/plan.md`, "# 계획\n");
    const input = { paths: ["plan.md"], place: PLACE, slug: "plan" };
    const first = await saveFromPaths(deps, input);
    assert(first.ok, first.ok ? "" : JSON.stringify(first.error));
    assertEquals(first.value.saved.status, "saved");
    const unchanged = await saveFromPaths(deps, input);
    assert(unchanged.ok, unchanged.ok ? "" : JSON.stringify(unchanged.error));
    assertEquals(unchanged.value.saved.status, "unchanged");
    assertEquals(unchanged.value.saved.event_seq, null);
    assertEquals(unchanged.value.saved.document, first.value.saved.document);
    await Deno.writeTextFile(`${opened.work}/plan.md`, "# 계획\n바뀐 본문\n");
    const changed = await saveFromPaths(deps, input);
    assert(changed.ok, changed.ok ? "" : JSON.stringify(changed.error));
    assertEquals(changed.value.saved.status, "saved");
    assert(changed.value.saved.version !== first.value.saved.version);
    const history = await post(opened, "documents/history", {
      document: first.value.saved.document,
    });
    assertEquals((history.versions as unknown[]).length, 2);
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/mcp-server#R14: 명시 format 부적합은 실제 검사에서 거절되고 문서가 생기지 않는다", async () => {
  const opened = await open();
  try {
    // csv는 document 형식의 media type이 아니다.
    await Deno.writeTextFile(`${opened.work}/data.csv`, "a,b\n1,2\n");
    const { client, deps } = agent(opened);
    const formats = await client.read(
      (await import("../../packages/contracts/documents/mod.ts")).formatList,
      {},
    );
    assert(formats.ok);
    const document = (formats.value as {
      formats: { name: string; module_hash: string }[];
    }).formats.find((format) => format.name === "document");
    assert(document);
    // 명시한 형식에 맞지 않는 파일은 검사 error라 저장하지 않는다.
    const refused = await saveFromPaths(deps, {
      paths: ["data.csv"],
      format: {
        name: "document",
        module_hash: document.module_hash,
        explicit: true,
      },
    });
    assert(!refused.ok);
    assertEquals(refused.error.code, "invalid_input");
    // 무저장: 문서가 생기지 않았다.
    const listed = await post(opened, "documents/list", {}, AGENT_TOKEN);
    assertEquals((listed.documents as unknown[]).length, 0);
    // 형식을 명시하지 않으면 같은 파일은 data 형식으로 저장된다.
    const implicit = await saveFromPaths(deps, { paths: ["data.csv"] });
    assert(implicit.ok, implicit.ok ? "" : JSON.stringify(implicit.error));
    const listedAfter = await post(opened, "documents/list", {}, AGENT_TOKEN);
    assertEquals((listedAfter.documents as unknown[]).length, 1);
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/mcp-server#R13 #R16: series 저장은 실제 core에서 같은 key로 가입하고 다음 제안이 core 값으로 나온다", async () => {
  const opened = await open();
  try {
    await createProject(opened);
    await post(opened, "series/create", {
      input: {
        id: SERIES,
        place: PLACE,
        name: "weekly",
        title: "주간 보고",
        format: "document",
        order: { kind: "key", direction: "ascending" },
        next_rule: "{n+1}",
      },
      idempotency_key: "series-1",
      compare: {},
      prepared: [],
    });
    const { deps } = agent(opened);
    const save = createSaveTool(deps);
    const series = createSeriesTool({ client: deps.client });
    const saveRoute = resolveRoute("lophn_save", undefined)!.route;
    const nextRoute = resolveRoute("lophn_series", "next")!.route;
    const next = async () =>
      await series("lophn_series", nextRoute, {
        op: "next",
        selector: { series: SERIES },
      });
    assertEquals(
      ((await next()).data as { reason: string }).reason,
      "first_key_manual",
    );
    await Deno.writeTextFile(`${opened.work}/week.md`, "# 1주차\n");
    const saved = await save("lophn_save", saveRoute, {
      paths: ["week.md"],
      place: PLACE,
      slug: "week-1",
      series: { series: SERIES },
      key: "1",
    });
    assertEquals(saved.isError, undefined, saved.summary);
    assertEquals(
      (saved.data as { series: unknown }).series,
      { series: SERIES, key: "1", joined: true },
    );
    const after = await next();
    assertEquals(
      (after.data as { reason: string; suggestion: { key: string } }).reason,
      "available",
    );
    assertEquals(
      (after.data as { suggestion: { key: string } }).suggestion.key,
      "2",
    );
    // 이미 쓴 key로 다른 문서를 저장하면 저장 전에 거절한다.
    await Deno.writeTextFile(`${opened.work}/week2.md`, "# 2주차\n");
    const taken = await save("lophn_save", saveRoute, {
      paths: ["week2.md"],
      place: PLACE,
      slug: "week-2",
      series: { series: SERIES },
      key: "1",
    });
    assertEquals(taken.isError, true);
    assertEquals(taken.summary, "이미 사용한 key다");
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/connection#R10: 금지 영역으로 이어진 파일은 어떤 바이트도 core로 보내기 전에 거절한다", async () => {
  const opened = await open();
  try {
    await Deno.writeTextFile(`${opened.work}/plan.md`, "# 계획\n");
    await Deno.writeTextFile(`${opened.home}/secret.md`, "secret");
    await Deno.symlink(
      `${opened.home}/secret.md`,
      `${opened.work}/secret-link.md`,
    );
    const { deps } = agent(opened);
    const before = await blobCount(opened.home);
    const refused = await saveFromPaths(deps, {
      paths: ["plan.md", "secret-link.md"],
    });
    assert(!refused.ok);
    assertEquals(refused.error.message, "제출할 수 없는 파일이다");
    // 허용 파일의 바이트도 보내지 않았다.
    assertEquals(await blobCount(opened.home), before);
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/mcp-server#R14: format 목록·선언과 파일 bytes 검사가 실제 core와 format 실행을 지난다", async () => {
  const opened = await open();
  try {
    const { deps } = agent(opened);
    const format = createFormatTool(deps);
    const route = (op: string) => resolveRoute("lophn_format", op)!.route;
    const listed = await format("lophn_format", route("list"), {
      op: "list",
      media_type: "text/markdown",
    });
    const names = (listed.data as { formats: { name: string }[] }).formats
      .map((item) => item.name);
    assertEquals(names, ["document", "data"]);
    const document = (listed.data as {
      formats: { name: string; module_hash: string }[];
    }).formats[0];
    const shown = await format("lophn_format", route("show"), {
      op: "show",
      name: "document",
      module_hash: document.module_hash,
    });
    assertEquals(shown.isError, undefined, shown.summary);
    assert(
      (shown.data as { guide: { text: string } }).guide.text.length > 0,
      "작성 안내가 있다",
    );
    // 검사는 저장이 아니다: 파일 bytes를 실제 format 실행에 보내고 판은 늘지 않는다.
    await Deno.writeTextFile(`${opened.work}/plan.md`, "# 계획\n본문\n");
    await Deno.writeTextFile(`${opened.work}/data.csv`, "a,b\n");
    const passed = await format("lophn_format", route("validate"), {
      op: "validate",
      name: "document",
      module_hash: document.module_hash,
      paths: ["plan.md"],
    });
    assertEquals(passed.isError, undefined, passed.summary);
    assertEquals((passed.data as { status: string }).status, "passed");
    const failed = await format("lophn_format", route("validate"), {
      op: "validate",
      name: "document",
      module_hash: document.module_hash,
      paths: ["data.csv"],
    });
    assertEquals(failed.isError, undefined, failed.summary);
    const data = failed.data as {
      status: string;
      diagnostics: { severity: string; file: string | null }[];
    };
    assertEquals(data.status, "failed");
    assertEquals(data.diagnostics[0].severity, "error");
    assertEquals(data.diagnostics[0].file, "data.csv");
    const listedDocuments = await post(
      opened,
      "documents/list",
      {},
      AGENT_TOKEN,
    );
    assertEquals((listedDocuments.documents as unknown[]).length, 0);
  } finally {
    await opened.dispose();
  }
});
