// lophn_save·lophn_format·lophn_series tool을 실제 core에 붙이는 통합 테스트다
// (coding-agent#T14, mcp#R13–R16). createCoreHarness로 core를 띄우고 coding agent
// credential로 만든 실제 core client가 documents route를 부른다. 데이터 root는 harness가
// 만든 temp dir다. 사람 데이터 root는 열지 않는다.
//
// 이 harness에는 I/O worker와 documents worker가 없어 `/v1/documents/prepare`가 서빙되지
// 않는다. 그 한 route만 같은 계약의 PreparedVersion을 만드는 테스트 자리(prepareStandIn)가
// 대신하고 준비 참조를 harness의 notePrepared로 core에 등록한다. 저장 command·읽기·series
// 가입·format 읽기는 모두 실제 core를 지난다. 준비 worker 자체는 documents/versions 테스트가
// 덮는다.
import { assert, assertEquals } from "@std/assert";
import { ok, type Result } from "../../packages/base/mod.ts";
import type { LophnError } from "../../packages/base/mod.ts";
import {
  type CoreClient,
  createCoreClient,
} from "../../packages/coding-agent/connection/client/core.ts";
import {
  canonicalFilesHash,
  type FlowClient,
} from "../../packages/coding-agent/connection/mod.ts";
import { createFormatTool } from "../../packages/coding-agent/mcp-server/tools/format.ts";
import { createSaveTool } from "../../packages/coding-agent/mcp-server/tools/save.ts";
import { createSeriesTool } from "../../packages/coding-agent/mcp-server/tools/series.ts";
import { resolveRoute } from "../../packages/coding-agent/mcp-server/registry.ts";
import { filesHash } from "../../packages/documents/versions/mod.ts";
import { BUILTIN_MODULE_HASH } from "../../packages/documents/formats/guest/module-hash.ts";
import { type CoreHarness, createCoreHarness } from "./testing/core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";

const teams: TeamModule[] = [{ createLedgerRegistration }];
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const SERIES = "ser_01arz3ndektsv4rrffq69g5fav";
const PLACE = { kind: "project" as const, id: PROJECT };
const NOW = Date.UTC(2024, 0, 1);
const PRINCIPAL = "coding-agent-1";

const AGENT_OPERATIONS = [
  "document.save",
  "document.list",
  "document.get",
  "document.history",
  "series.list",
  "series.get",
  "series.next",
  "series.add_instance",
  "format.list",
  "format.get",
];

type Setup = {
  harness: CoreHarness;
  user: string;
  client: FlowClient;
  core: CoreClient;
  bodyOf: (path: string, input: unknown) => Promise<Record<string, unknown>>;
};

function hashOf(text: string): string {
  return text.padEnd(64, "0");
}

type UploadedFile = {
  path: string;
  media_type: string;
  bytes: number;
  blob_hash: string;
  primary: boolean;
  content: unknown;
};

// 준비된 두 파일. blob_hash만 내용 구분용으로 바꾼다.
function files(content: string): UploadedFile[] {
  const hash = hashOf(content.replace(/[^0-9a-f]/g, "a") || "a");
  return [{
    path: "plan.md",
    media_type: "text/markdown",
    bytes: 7,
    blob_hash: hash,
    primary: true,
    content: {
      kind: "prepared",
      blob: {
        preparation: `blob-${content}`,
        principal: PRINCIPAL,
        purpose: "document_file",
        hash,
        size_bytes: 7,
      },
    },
  }];
}

async function open(): Promise<Setup> {
  const opened = await createCoreHarness({
    teams,
    teamModules: [new URL("./documents.ts", import.meta.url).href],
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  const user = await harness.credential({
    actor: "user",
    principal: "user-1",
    scope: {
      operations: [
        "project.create",
        "series.create",
        "document.save",
        "document.list",
        "document.get",
        "document.history",
      ],
      targets: {},
    },
    conditions: {},
  });
  assert(user.ok, user.ok ? "" : user.error.message);
  const userToken = user.value.token;
  const agent = await harness.credential({
    actor: "coding_agent",
    principal: PRINCIPAL,
    scope: { operations: AGENT_OPERATIONS, targets: {} },
    conditions: {},
  });
  assert(agent.ok, agent.ok ? "" : agent.error.message);
  const core = createCoreClient({
    baseUrl: `http://127.0.0.1:${harness.port}`,
    connection: CAC,
    provider: () =>
      Promise.resolve({ ok: true, value: { token: agent.value.token } }),
  });
  const client: FlowClient = {
    command: (route, body) => core.command(route, body),
    read: (route, input) => {
      if (route.name !== "document.prepare") return core.read(route, input);
      return prepareStandIn(harness, input);
    },
  };
  async function bodyOf(path: string, input: unknown) {
    const response = await fetch(
      `http://127.0.0.1:${harness.port}/v1/${path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify(input),
      },
    );
    const text = await response.text();
    assertEquals(response.status, 200, `${path}: ${text}`);
    return JSON.parse(text) as Record<string, unknown>;
  }
  return { harness, user: userToken, client, core, bodyOf };
}

// `/v1/documents/prepare` worker가 없는 harness의 대역이다. 준비 worker가 하는 일(같은
// hash 계산·준비 참조 묶기)을 계약대로 하고 준비 참조는 core에 등록한다.
async function prepareStandIn(
  harness: CoreHarness,
  input: unknown,
): Promise<Result<unknown, LophnError>> {
  const request = input as {
    document: string;
    base_version: string | null;
    metadata?: unknown;
    files: UploadedFile[];
    format?: { name: string; module_hash: string; explicit: boolean };
    idempotency_key: string;
  };
  const contentFiles = request.files.map((file) => ({
    path: file.path,
    blob_hash: file.blob_hash,
    bytes: file.bytes,
    media_type: file.media_type,
    primary: file.primary,
  }));
  const hash = await filesHash(contentFiles);
  // 통로가 계산하는 입력 hash와 documents의 content_hash 정의가 같은 값이다.
  assertEquals(await canonicalFilesHash(contentFiles), hash);
  const preparation = `prep-${request.idempotency_key}`;
  const noted = await harness.notePrepared({
    preparation,
    principal: PRINCIPAL,
    purpose: "document_files",
    hash,
    size_bytes: 0,
  }, NOW);
  assert(noted.ok, noted.ok ? "" : noted.error.message);
  const format = request.format ??
    { name: "document", module_hash: BUILTIN_MODULE_HASH, explicit: false };
  return ok({
    document: request.document,
    base_version: request.base_version,
    files_hash: hash,
    file_count: request.files.length,
    primary_path: "plan.md",
    content_hash: hash,
    preparation_ref: preparation,
    idempotency_key: request.idempotency_key,
    ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
    format,
    validation: {
      input_hash: hash,
      module_hash: format.module_hash,
      status: "passed",
      error_count: 0,
      warning_count: 0,
      diagnostics: [],
    },
    source: null,
  });
}

async function createProject(setup: Setup) {
  await setup.bodyOf("projects/create", {
    input: {
      id: PROJECT,
      name: "mahas",
      title: "Notes",
      purpose: "",
      folders: [{ path: "/tmp/lophn-test-save-tool", description: "" }],
      tracking: { enabled: false, patterns: [], use_gitignore: false },
    },
    idempotency_key: "project-1",
    compare: {},
    prepared: [],
  });
}

async function createSeries(setup: Setup) {
  await setup.bodyOf("series/create", {
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
}

function toolOf(name: string, op: string | undefined) {
  const resolved = resolveRoute(name, op);
  assert(resolved);
  return resolved.route;
}

type ToolOut = {
  summary: string;
  data: Record<string, unknown>;
  next: string[];
  isError?: true;
};

Deno.test("coding-agent/mcp-server#R13 #R15: 자리 없는 저장은 고정 주소로 다시 읽히고 같은 요청의 재전송은 새 판을 만들지 않는다", async () => {
  const setup = await open();
  try {
    const save = createSaveTool({ client: setup.client });
    const route = toolOf("lophn_save", undefined);
    const first = await save("lophn_save", route, {
      files: files("11"),
    }) as ToolOut;
    assertEquals(first.isError, undefined, first.summary);
    assertEquals(first.data.status, "saved");
    assertEquals(first.data.placed, false);
    assertEquals(first.next[0].includes("자리 선택은 사람이"), true);
    const document = first.data.document as string;
    // 고정 주소(document id·판)로 다시 읽힌다.
    const got = await setup.bodyOf("documents/get", {
      document,
      version: first.data.version,
    });
    assertEquals((got.version as { number: number }).number, 1);
    // 같은 요청의 재전송은 같은 판을 돌려주고 새 판이 없다.
    const again = await save("lophn_save", route, {
      files: files("11"),
    }) as ToolOut;
    assertEquals(again.isError, undefined, again.summary);
    assertEquals(again.data.document, document);
    assertEquals(again.data.version, first.data.version);
    const history = await setup.bodyOf("documents/history", { document });
    assertEquals((history.versions as unknown[]).length, 1);
  } finally {
    await setup.harness.close();
  }
});

Deno.test("coding-agent/mcp-server#R13: 자리 있는 저장의 재전송은 unchanged이고 바뀐 내용은 새 판이다", async () => {
  const setup = await open();
  try {
    await createProject(setup);
    const save = createSaveTool({ client: setup.client });
    const route = toolOf("lophn_save", undefined);
    const input = (content: string) => ({
      files: files(content),
      place: PLACE,
      slug: "plan",
      title: "계획",
    });
    const first = await save("lophn_save", route, input("11")) as ToolOut;
    assertEquals(first.isError, undefined, first.summary);
    assertEquals(first.data.status, "saved");
    // core의 고정 참조는 문서 ID와 판 ID다. 주소 문자열이 아니라 그 참조를 낸다.
    assertEquals(first.data.address, null);
    assertEquals(first.summary.includes(`${first.data.document}@`), true);
    assertEquals(first.data.reference, {
      document: first.data.document,
      version: first.data.version,
      section: null,
    });
    const unchanged = await save("lophn_save", route, input("11")) as ToolOut;
    assertEquals(unchanged.isError, undefined, unchanged.summary);
    assertEquals(unchanged.data.status, "unchanged");
    assertEquals(unchanged.data.event_seq, null);
    assertEquals(unchanged.data.document, first.data.document);
    const changed = await save("lophn_save", route, input("22")) as ToolOut;
    assertEquals(changed.isError, undefined, changed.summary);
    assertEquals(changed.data.status, "saved");
    assert(changed.data.version !== first.data.version);
    const history = await setup.bodyOf("documents/history", {
      document: first.data.document,
    });
    assertEquals((history.versions as unknown[]).length, 2);
  } finally {
    await setup.harness.close();
  }
});

Deno.test("coding-agent/mcp-server#R13 #R16: series 저장은 같은 key로 가입하고 다음 제안·이미 쓴 key가 core 값으로 나온다", async () => {
  const setup = await open();
  try {
    await createProject(setup);
    await createSeries(setup);
    const save = createSaveTool({ client: setup.client });
    const series = createSeriesTool({ client: setup.client });
    const seriesRoute = (op: string) => toolOf("lophn_series", op);
    const next = (): Promise<ToolOut> =>
      series("lophn_series", seriesRoute("next"), {
        op: "next",
        selector: { series: SERIES },
      }) as Promise<ToolOut>;
    // 가족이 비어 있으면 첫 key는 직접 정한다.
    const firstSuggestion = await next();
    assertEquals(firstSuggestion.data.reason, "first_key_manual");

    const route = toolOf("lophn_save", undefined);
    const saved = await save("lophn_save", route, {
      files: files("11"),
      place: PLACE,
      slug: "week-1",
      series: { series: SERIES },
      key: "1",
    }) as ToolOut;
    assertEquals(saved.isError, undefined, saved.summary);
    assertEquals(saved.data.series, { series: SERIES, key: "1", joined: true });
    // 다음 제안은 규칙({n+1})에 따라 2다. 문서도 가족도 만들어지지 않았다.
    const second = await next();
    assertEquals(second.data.reason, "available");
    assertEquals(
      (second.data.suggestion as { key: string }).key,
      "2",
    );
    const shown = await series("lophn_series", seriesRoute("show"), {
      op: "show",
      selector: { series: SERIES },
    }) as ToolOut;
    assertEquals(
      (shown.data.entries as { key: string }[]).map((entry) => entry.key),
      ["1"],
    );
    // 이미 쓴 key로 다른 문서를 저장하면 저장 전에 거절한다.
    const taken = await save("lophn_save", route, {
      files: files("22"),
      place: PLACE,
      slug: "week-2",
      series: { series: SERIES },
      key: "1",
    }) as ToolOut;
    assertEquals(taken.isError, true);
    assertEquals(taken.summary, "이미 사용한 key다");
    const listed = await setup.bodyOf("documents/list", { place: PLACE });
    assertEquals((listed.documents as unknown[]).length, 1);
    // 다음 key로 저장하면 가족이 둘이 된다.
    const joined = await save("lophn_save", route, {
      files: files("22"),
      place: PLACE,
      slug: "week-2",
      series: { series: SERIES },
      key: "2",
    }) as ToolOut;
    assertEquals(joined.isError, undefined, joined.summary);
    const after = await series("lophn_series", seriesRoute("show"), {
      op: "show",
      selector: { series: SERIES },
    }) as ToolOut;
    assertEquals(
      (after.data.entries as { key: string }[]).map((entry) => entry.key),
      ["1", "2"],
    );
  } finally {
    await setup.harness.close();
  }
});

Deno.test("coding-agent/mcp-server#R14: format 목록·선언이 core의 설치된 format 값으로 나온다", async () => {
  const setup = await open();
  try {
    const format = createFormatTool({ client: setup.client });
    const route = (op: string) => toolOf("lophn_format", op);
    const listed = await format("lophn_format", route("list"), {
      op: "list",
      media_type: "application/pdf",
    }) as ToolOut;
    assertEquals(
      (listed.data.formats as { name: string }[]).map((item) => item.name),
      ["pdf", "data"],
    );
    const shown = await format("lophn_format", route("show"), {
      op: "show",
      name: "document",
      module_hash: BUILTIN_MODULE_HASH,
    }) as ToolOut;
    assertEquals(shown.isError, undefined, shown.summary);
    assertEquals(shown.data.name, "document");
    assert(
      (shown.data.guide as { text: string }).text.length > 0,
      "작성 안내가 있다",
    );
    // 모르는 module hash는 core의 not_found를 그대로 낸다.
    const missing = await format("lophn_format", route("show"), {
      op: "show",
      name: "document",
      module_hash: "e".repeat(64),
    }) as ToolOut;
    assertEquals(missing.isError, true);
  } finally {
    await setup.harness.close();
  }
});
