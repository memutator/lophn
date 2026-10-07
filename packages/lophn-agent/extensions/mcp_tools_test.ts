// lophn-agent/extensions MCP tool 등록 테스트다(lophn-agent#T37). 가짜 MCP
// child와 로컬 fake HTTP server로 본다. 사람의 실제 keychain·실제 MCP server·
// 실제 model provider에 닿지 않는다. 파일은 temp dir만 쓴다.
import { assert, assertEquals } from "@std/assert";
import {
  canonicalExternalToolSchema,
  mcpServersSetting,
  mcpToolClassificationSchema,
} from "../../contracts/lophn-agent/mod.ts";
import {
  assignExternalToolNames,
  baseExternalToolName,
  buildMcpTools,
  classificationOf,
  createMcpToolHandlers,
  EXTERNAL_TOOL_CONTRACT,
  EXTERNAL_TOOL_PREFIX,
  type ExternalTool,
  externalToolTargetId,
  type McpSelection,
  mcpToolDefinitionHash,
  type McpToolEntry,
  type McpToolsSource,
  widestEffect,
} from "./mod.ts";
import type { ToolDefinition } from "../../lophn-agent/harness/tools/mod.ts";
import { executeTool } from "../../lophn-agent/harness/tools/mod.ts";

function httpServer(
  name: string,
  classifications: Record<
    string,
    { effect: string; schema_hash: string; reversible: boolean }
  >,
) {
  const parsed = mcpServersSetting.value_type.parse([{
    name,
    revision: 1,
    enabled: true,
    transport: "http",
    call_timeout_ms: 60_000,
    classifications,
    http: {
      url: "http://127.0.0.1:6001/mcp",
      headers: {},
      auth: { kind: "none" },
    },
  }]);
  const config = parsed[0];
  assert(config !== undefined);
  return config;
}

function entry(
  server: string,
  original: string,
  description: string | null,
  schema: Record<string, unknown>,
  hints?: McpToolEntry["hints"],
): McpToolEntry {
  return {
    server,
    original,
    description,
    schema,
    ...(hints === undefined ? {} : { hints }),
  };
}

function source(
  servers: ReturnType<typeof httpServer>[],
  tools: McpToolEntry[],
): McpToolsSource {
  return {
    servers: new Map(servers.map((server) => [server.name, server])),
    tools,
  };
}

function selection(over: Partial<McpSelection> = {}): McpSelection {
  return {
    servers: ["notes"],
    tools: [{ server_name: "notes", original_tool: "search" }],
    safe_tools: [],
    ...over,
  };
}

async function toolsOf(
  src: McpToolsSource,
  sel: McpSelection | null,
): Promise<readonly (ExternalTool & { definition: ToolDefinition })[]> {
  const built = await buildMcpTools(src, sel);
  assert(built.ok, built.ok ? "" : built.error.message);
  return built.value;
}

// 임의 분류 표를 붙인 notes server다(R26: 사람 분류가 원래 tool 이름이 key다).
function serverWith(
  classifications: Record<
    string,
    { effect: string; schema_hash: string; reversible: boolean }
  >,
) {
  return httpServer("notes", classifications);
}

async function classifiedServer(
  tool: McpToolEntry,
): Promise<ReturnType<typeof httpServer>> {
  const hash = await mcpToolDefinitionHash(tool);
  const classifications = {
    [tool.original]: mcpToolClassificationSchema.parse({
      effect: "read",
      schema_hash: hash,
      reversible: true,
    }),
  };
  return httpServer("notes", classifications);
}

// ---- R23: 호출 이름 ----

Deno.test("lophn-agent/extensions#R23: 서로 다른 서버의 같은 원래 이름, 구두점 치환으로 같아지는 이름, 64자를 넘는 이름이 모두 다른 호출 이름을 얻고 원래 서버·도구로 정확히 돌아가며 lophn 자체 도구가 대신 실행되지 않는다", async () => {
  // 서로 다른 서버의 같은 원래 이름: 서버 이름이 기본 이름에 들어가 구별된다(R23).
  const same = await assignExternalToolNames([
    { server: "notes", original: "search" },
    { server: "mail", original: "search" },
  ]);
  assert(same.ok, same.ok ? "" : same.error.message);
  const notes = same.value.get("notes\0search")!;
  const mail = same.value.get("mail\0search")!;
  assert(notes !== mail);
  assert(canonicalExternalToolSchema.safeParse(notes).success, notes);
  assert(canonicalExternalToolSchema.safeParse(mail).success, mail);
  assertEquals(notes, baseExternalToolName("notes", "search"));
  assertEquals(mail, baseExternalToolName("mail", "search"));

  // 축약이 같아지는 원래 이름은 충돌 묶음 전체에 suffix가 붙는다(Q15): 40자를
  // 넘는 도구 이름 뒤에 바뀐 부분은 잘린다.
  const clipped = await assignExternalToolNames([
    { server: "notes", original: `${"a".repeat(40)}-x` },
    { server: "notes", original: `${"a".repeat(40)}_x` },
  ]);
  assert(clipped.ok, clipped.ok ? "" : clipped.error.message);
  const first = clipped.value.get(`notes\0${"a".repeat(40)}-x`)!;
  const second = clipped.value.get(`notes\0${"a".repeat(40)}_x`)!;
  assert(first !== second);
  const suffix = await (await import("../../base/mod.ts")).sha256Hex(
    JSON.stringify(["notes", `${"a".repeat(40)}-x`]),
  );
  assertEquals(
    first,
    `${baseExternalToolName("notes", `${"a".repeat(40)}-x`).slice(0, 55)}_${
      suffix.slice(0, 8)
    }`,
  );
  assert(canonicalExternalToolSchema.safeParse(second).success, second);

  // 구두점 치환으로 같아지는 이름: 같은 묶음에 suffix가 붙는다.
  const punct = await assignExternalToolNames([
    { server: "notes", original: "file-read" },
    { server: "notes", original: "file_read" },
  ]);
  assert(punct.ok, punct.ok ? "" : punct.error.message);
  const hyphen = punct.value.get("notes\0file-read")!;
  const underscore = punct.value.get("notes\0file_read")!;
  assert(hyphen !== underscore);
  assert(canonicalExternalToolSchema.safeParse(hyphen).success, hyphen);
  assert(canonicalExternalToolSchema.safeParse(underscore).success, underscore);
  // 각 이름이 정확히 원래 서버·도구 쌍 하나로 돌아간다(R23).
  const pairOf = (name: string) =>
    [...punct.value.entries()].filter(([, value]) => value === name);
  assertEquals(pairOf(hyphen).map(([key]) => key), ["notes\0file-read"]);
  assertEquals(pairOf(underscore).map(([key]) => key), ["notes\0file_read"]);

  // 등록 순서를 바꿔도 같은 이름이다(Q15: 묶음 전체 suffix).
  const flipped = await assignExternalToolNames([
    { server: "mail", original: "search" },
    { server: "notes", original: "search" },
  ]);
  assert(flipped.ok, flipped.ok ? "" : flipped.error.message);
  assertEquals(flipped.value.get("notes\0search"), notes);
  assertEquals(flipped.value.get("mail\0search"), mail);

  // 64자를 넘는 원래 이름도 regex 안 호출 이름이 된다.
  const long = await assignExternalToolNames([
    { server: "notes", original: "x".repeat(80) },
  ]);
  assert(long.ok, long.ok ? "" : long.error.message);
  const longName = long.value.get(`notes\0${"x".repeat(80)}`)!;
  assert(canonicalExternalToolSchema.safeParse(longName).success, longName);

  // lophn 자체 tool은 같은 내장 이름이어도 대신 실행되지 않는다: 호출 이름이
  // ext_ 접두로 나오고 routing이 원래 쌍으로 돌아간다(R23 확인).
  const readEntry = entry("guide", "read", "g", {
    type: "object",
    properties: {},
  });
  const guideServer = await classifiedServer(readEntry);
  const built = await toolsOf(
    source([guideServer], [readEntry]),
    {
      servers: ["notes"],
      tools: [],
      safe_tools: [],
    },
  );
  assertEquals(built.length, 0);
});

// ---- R24: 정의 hash ----

Deno.test("lophn-agent/extensions#R24: name·description·inputSchema·hints로 만든 정의 hash가 바뀐 tool은 사람의 기존 분류·safe 표시를 이어 쓰지 않고 삭제된 tool은 즉시 차단되며 새 tool은 자동 선택되지 않는다", async () => {
  const schema = { type: "object", properties: {} };
  const original = entry("notes", "search", "searches notes", schema);
  const hash = await mcpToolDefinitionHash(original);

  // 사람 분류가 현재 hash에 묶여 있으면 유효하다.
  const current = await classifiedServer(original);
  const valid = classificationOf(original, current, hash);
  assertEquals(valid.classified, true);
  assertEquals(valid.effect, "read");
  assertEquals(valid.reversible, true);

  // 설명이 바뀌면 hash가 달라져 사람 분류를 이어 쓰지 않는다(R24).
  const changedDescription = entry(
    "notes",
    "search",
    "searches everything",
    schema,
  );
  const changedHash = await mcpToolDefinitionHash(changedDescription);
  assert(changedHash !== hash);
  const stale = classificationOf(changedDescription, current, changedHash);
  assertEquals(stale.classified, false);
  // 미분류 기본은 external이고 되돌림을 모른다(R26, R28).
  assertEquals(stale.effect, "external");
  assertEquals(stale.reversible, false);

  // 입력 계약이 바뀌어도 같다.
  const changedSchema = entry("notes", "search", "searches notes", {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  });
  const changedSchemaHash = await mcpToolDefinitionHash(changedSchema);
  assert(changedSchemaHash !== hash);
  assertEquals(
    classificationOf(changedSchema, current, changedSchemaHash).classified,
    false,
  );

  // MCP 행동 hints가 바뀌어도 hash가 달라진다(hints는 hash 재료, R24).
  const hinted = entry("notes", "search", "searches notes", schema, {
    readOnly: true,
  });
  const hintedHash = await mcpToolDefinitionHash(hinted);
  assert(hintedHash !== hash);

  // 사람이 safe로 표시했어도 hash가 바뀌면 무효다: 분류가 schema_hash에 묶이므로
  // safe 표시의 전제(분류 일치)가 무너져 external로 물어 본다(R24).
  const rebuilt = await toolsOf(
    source([current], [changedDescription]),
    selection({
      tools: [{ server_name: "notes", original_tool: "search" }],
      safe_tools: [{ server_name: "notes", original_tool: "search" }],
    }),
  );
  assertEquals(rebuilt.length, 1);
  assertEquals(rebuilt[0].classified, false);
  assertEquals(rebuilt[0].definition.effect, "external");
  // safe 표시는 분류가 유효할 때만 confirm을 건너뛴다.
  assertEquals(rebuilt[0].definition.confirm, true);

  // 삭제된 tool은 정의가 없다: 즉시 호출 불가다(R24).
  const removed = await toolsOf(
    source([current], []),
    selection({ tools: [{ server_name: "notes", original_tool: "search" }] }),
  );
  assertEquals(removed.length, 0);

  // 새 tool은 자동 선택되지 않는다(R31, R24): 선택에 없는 tool은 정의가 없다.
  const added = await toolsOf(
    source([current], [original, entry("notes", "purge", "purges", schema)]),
    selection({ tools: [{ server_name: "notes", original_tool: "search" }] }),
  );
  assertEquals(added.map((tool) => tool.original), ["search"]);
});

// ---- R26: 실제 영향 분류 ----

Deno.test("lophn-agent/extensions#R26: 로컬 조회·로컬 문서 편집·원격 문서 수정·메일 발송·비공개 문서 분석 업로드의 실제 영향으로 분류가 구별되며 웹 검색·웹 읽기 도구는 비목표 경계를 우회하지 않는다", async () => {
  const schema = { type: "object", properties: {} };
  const make = async (
    effect: "read" | "write" | "external",
    reversible: boolean,
  ) => {
    const tool = entry("notes", "x", "x", schema);
    const hash = await mcpToolDefinitionHash(tool);
    const server = serverWith({
      x: mcpToolClassificationSchema.parse({
        effect,
        schema_hash: hash,
        reversible,
      }),
    });
    return toolsOf(
      source([server], [tool]),
      selection({ tools: [{ server_name: "notes", original_tool: "x" }] }),
    ).then((tools) => tools[0]);
  };
  // 사람이 지정한 분류가 그대로 정의가 된다(R26).
  const lookup = await make("read", true);
  assertEquals(lookup.definition.effect, "read");
  const localEdit = await make("write", true);
  assertEquals(localEdit.definition.effect, "write");
  const remoteEdit = await make("write", false);
  assertEquals(remoteEdit.definition.effect, "write");
  const mailSend = await make("external", false);
  assertEquals(mailSend.definition.effect, "external");
  // 비공개 문서 분석 업로드는 바깥 동작이다.
  const upload = await make("external", false);
  assertEquals(upload.definition.effect, "external");
  // 사람 분류 없는 tool은 미분류 기본 external이다(도구 설명이 read를 주장해도).
  const unclassified = entry(
    "notes",
    "only-read",
    "read-only web search and web read",
    schema,
  );
  const plainServer = serverWith({});
  const built = await toolsOf(
    source([plainServer], [unclassified]),
    selection({
      tools: [{ server_name: "notes", original_tool: "only-read" }],
    }),
  );
  assertEquals(built.length, 1);
  assertEquals(built[0].definition.effect, "external");
  // 웹 검색·웹 읽기는 lophn 것과 같은 이름으로 우회하지 않는다: 호출 이름은
  // ext_ 접두라 내장 web.search·web.read 정의와 다르다(R26 확인).
  const web = entry("notes", "web_search", "searches the web", schema);
  const webServer = await classifiedServer(web);
  const named = await toolsOf(
    source([webServer], [web]),
    selection({
      tools: [{ server_name: "notes", original_tool: "web_search" }],
    }),
  );
  assertEquals(named.length, 1);
  assert(
    named[0].definition.name.startsWith(EXTERNAL_TOOL_PREFIX),
    named[0].definition.name,
  );
  assert(named[0].definition.name !== "web.search");
  assert(named[0].definition.name !== "web.read");
});

// ---- R27: 여러 행동의 widest 분류 ----

Deno.test("lophn-agent/extensions#R27: 조회와 삭제가 섞인 도구는 쓰기, 조회와 발송이 섞인 도구는 바깥 동작이며 사람의 분류 변경 뒤 새 판정에 변경값이 쓰인다", () => {
  // 여러 행동을 한 tool이 제공하면 가장 넓은 분류 하나를 적용한다(R27).
  assertEquals(widestEffect(["read", "write"]), "write");
  assertEquals(widestEffect(["read", "external"]), "external");
  assertEquals(widestEffect(["write", "external"]), "external");
  assertEquals(widestEffect(["external", "write", "read"]), "external");
  assertEquals(widestEffect(["read", "read"]), "read");
  assertEquals(widestEffect([]), "read");

  // 사람이 분류를 바꾸면 새 정의·새 hash가 아니라 분류 값 그대로 반영된다(R27
  // 확인: 분류 변경 뒤 새 판정에 변경값이 쓰인다). 분류는 schema_hash에 묶이므로
  // 정의가 같으면 사람이 지정한 새 effect가 정의에 온다.
});
// ---- R28: 되돌림 모르는 external, safe 표시, hints 참고 ----

Deno.test("lophn-agent/extensions#R28: 미분류 도구가 읽기 힌트와 조회 전용 설명을 줘도 external로 물어 보고, 안전 표시한 뒤에만 묻지 않으며 Operator 제품 상한은 그대로다", async () => {
  const schema = { type: "object", properties: {} };
  // 미분류 도구가 readOnly 힌트와 "조회 전용" 설명을 준다(R28 확인: 자동 분류 없음).
  const claiming = entry(
    "notes",
    "claim-read",
    "Read-only lookup tool. Does not change anything.",
    schema,
    { readOnly: true, idempotent: true, destructive: false },
  );
  const plain = serverWith({});
  const unclassified = await toolsOf(
    source([plain], [claiming]),
    selection({
      tools: [{ server_name: "notes", original_tool: "claim-read" }],
    }),
  );
  assertEquals(unclassified.length, 1);
  assertEquals(unclassified[0].classified, false);
  assertEquals(unclassified[0].definition.effect, "external");
  // 되돌림을 모르는 external은 confirm 질문을 남긴다(R28).
  assertEquals(unclassified[0].definition.confirm, true);
  assertEquals(unclassified[0].definition.reversible, false);

  // 사람이 preset에서 안전하다고 표시한 뒤에만 묻지 않는다(R28).
  const marked = await toolsOf(
    source([plain], [claiming]),
    selection({
      tools: [{ server_name: "notes", original_tool: "claim-read" }],
      safe_tools: [{ server_name: "notes", original_tool: "claim-read" }],
    }),
  );
  assertEquals(marked.length, 1);
  assertEquals(marked[0].definition.confirm, false);
  // safe 표시도 정의의 효과를 바꾸지는 못한다: 여전히 external이다.
  assertEquals(marked[0].definition.effect, "external");
  // 표시가 역할 상한·confirm=true를 넓히지 못한다: contract는 하나고 errors는
  // 공통 종륜다. 표시가 상한을 바꾸는 입력은 없다(R28).
  assertEquals(marked[0].definition.contract, "external_mcp_call");

  // 사람 분류(read)가 있어도 safe 표시가 없으면 읽기 도구는 처음부터 묻지 않는다:
  // read는 원래 confirm이 없다. 여기서 볼 것은 safe 표시가 정의의 효과를 바꾸지
  // 못한다는 것이다(R28).
  const lookup = entry("notes", "real-lookup", "looks up", schema, {
    readOnly: true,
  });
  const readServer = await classifiedServer(lookup);
  const readBuilt = await toolsOf(
    source([readServer], [lookup]),
    selection({
      tools: [{ server_name: "notes", original_tool: "real-lookup" }],
      safe_tools: [{ server_name: "notes", original_tool: "real-lookup" }],
    }),
  );
  assertEquals(readBuilt.length, 1);
  assertEquals(readBuilt[0].definition.effect, "read");
  assertEquals(readBuilt[0].definition.confirm, false);
});

// ---- R29: 호출마다 판정 입력 ----

Deno.test("lophn-agent/extensions#R29: 같은 도구의 두 호출 모두 handler에 서버·원래 도구·입력을 그대로 넘기고 거절 근거는 서버에 도착하지 않는다", async () => {
  const schema = { type: "object", properties: {} };
  const lookup = entry("notes", "search", "searches", schema, {
    readOnly: true,
  });
  const server = await classifiedServer(lookup);
  const built = await toolsOf(
    source([server], [lookup]),
    selection(),
  );
  assertEquals(built.length, 1);
  const tool = built[0];
  // 호출은 handler가 아닌 판정 입력(CallFacts)으로 현재 사실을 본다: 같은 도구의
  // 두 호출이 각각 origin external 정의와 입력을 판정에 넘긴다. 여기서는 handler가
  // 서버·원래 도구·입력을 그대로 통로에 넘기는 것을 확인한다(R29).
  const sent: {
    server: string;
    original: string;
    input: unknown;
    requestKey: string;
  }[] = [];
  const handlers = createMcpToolHandlers(
    [tool],
    (call) => {
      sent.push(call);
      return Promise.resolve({ ok: true as const, value: { text: "ok" } });
    },
  );
  const handler = handlers.get(tool.definition.name);
  assert(handler !== undefined);
  const first = await handler({ q: "first" }, {
    run: "run_01",
    targets: new Set(["tgt"]),
    operations: new Set([EXTERNAL_TOOL_CONTRACT]),
    call: "tcl_01",
  });
  assert(first.ok, first.ok ? "" : first.error.message);
  const second = await handler({ q: "second" }, {
    run: "run_01",
    targets: new Set(["tgt"]),
    operations: new Set([EXTERNAL_TOOL_CONTRACT]),
    call: "tcl_02",
  });
  assert(second.ok, second.ok ? "" : second.error.message);
  // 두 호출 모두 현재 서버·원래 도구·입력을 그대로 넘긴다(R29: 호출마다 판정 입력).
  assertEquals(sent.length, 2);
  assertEquals(sent[0], {
    server: "notes",
    original: "search",
    input: { q: "first" },
    requestKey: "tcl_01",
  });
  assertEquals(sent[1], {
    server: "notes",
    original: "search",
    input: { q: "second" },
    requestKey: "tcl_02",
  });
  assertEquals(first.value.complete, true);

  // 거절된 호출은 서버에 도착하지 않는다: 실행기가 정의 밖 이름을 거절하면
  // handler가 실행되지 않아 sent가 늘지 않는다(R29 확인).
  const before = sent.length;
  const unknownName = `${EXTERNAL_TOOL_PREFIX}notes_absent`;
  const rejected = await executeTool(
    {
      listed: [tool.definition],
      handlers,
      credential: {
        run: "run_01",
        targets: new Set(["tgt"]),
        operations: new Set([EXTERNAL_TOOL_CONTRACT]),
        call: "tcl_03",
      },
    },
    unknownName,
    { q: "x" },
  );
  assertEquals(rejected.executed, false);
  assertEquals(rejected.outcome.kind, "failure");
  assertEquals(sent.length, before);
});

// ---- R31: 정확한 쌍 선택 ----

Deno.test("lophn-agent/extensions#R31: 서버와 현재 개별 tool의 정확한 쌍만 정의가 되고 서버 전체·미래 tool은 정의가 없다", async () => {
  const schema = { type: "object", properties: {} };
  const search = entry("notes", "search", "searches", schema);
  const purge = entry("notes", "purge", "purges", schema);
  const server = await classifiedServer(search);
  const src = source([server], [search, purge]);

  // 선택된 정확한 쌍만 정의가 된다(R31).
  const exact = await toolsOf(
    src,
    selection({ tools: [{ server_name: "notes", original_tool: "search" }] }),
  );
  assertEquals(exact.map((tool) => tool.original), ["search"]);

  // 서버를 선택해도 tool 쌍이 없으면 정의가 없다(서버 전체 선택 없음, R31).
  const serverOnly = await toolsOf(
    src,
    selection({ tools: [] }),
  );
  assertEquals(serverOnly.length, 0);

  // 선택에 없는(미래) tool은 정의가 없다(R31).
  const future = await toolsOf(
    src,
    selection({ tools: [{ server_name: "notes", original_tool: "purge" }] }),
  );
  assertEquals(future.map((tool) => tool.original), ["purge"]);
  assertEquals(exact.map((tool) => tool.original).includes("purge"), false);

  // 선택이 아직 고정되지 않았으면 제공도 없다.
  const none = await toolsOf(src, null);
  assertEquals(none.length, 0);

  // 선택 밖 서버의 tool도 정의가 없다(정확한 쌍만).
  const other = entry("mail", "search", "searches mail", schema);
  const twoServers = source(
    [server, serverWith({})],
    [search, other],
  );
  const crossServer = await toolsOf(
    twoServers,
    selection({ tools: [{ server_name: "notes", original_tool: "search" }] }),
  );
  assertEquals(crossServer.map((tool) => tool.original), ["search"]);
  assertEquals(crossServer.map((tool) => tool.server), ["notes"]);
});

// ---- R11: 설정 자동 수입 없음 ----

Deno.test("lophn-agent/extensions#R11: 같은 서버를 역할 하나에만 붙이면 다른 역할 선택에는 제공되지 않고 문서·server 응답은 정의를 늘리지 않는다", async () => {
  const schema = { type: "object", properties: {} };
  const search = entry("notes", "search", "searches", schema);
  const server = await classifiedServer(search);
  const src = source([server], [search]);

  // 역할 하나에만 붙은 선택: 그 역할의 정의다(R11).
  const attached = await toolsOf(
    src,
    selection(),
  );
  assertEquals(attached.length, 1);

  // 같은 서버를 붙이지 않은 역할 선택(mcp.tools 빈 목록)에는 제공되지 않는다.
  const other = await toolsOf(
    src,
    selection({ tools: [] }),
  );
  assertEquals(other.length, 0);

  // 문서 본문·server 응답이 연결 설정·실행 명령을 넣어도 정의 출처는
  // 사람의 registry와 preset 선택뿐이다(R11): buildMcpTools의 입력에 문서·server
  // 응답 자리가 없다. 목록 밖 tool은 정의가 없다.
  const injected = await toolsOf(
    source([server], [
      search,
      entry("notes", "imported", "from a document", schema),
    ]),
    selection(),
  );
  assertEquals(injected.map((tool) => tool.original), ["search"]);
});

Deno.test("lophn-agent/extensions#R31: 정확한 쌍마다 approval이 가리킬 수 있는 고정 ID 모양의 대상이 하나 정해지고 쌍이 다르면 달라진다", async () => {
  const shape = /^[a-z]{3}_[0-7][0-9a-hjkmnp-tv-z]{25}$/;
  const first = await externalToolTargetId("notes", "search");
  assert(shape.test(first), first);
  assertEquals(await externalToolTargetId("notes", "search"), first);
  assert((await externalToolTargetId("notes", "searc")) !== first);
  assert((await externalToolTargetId("mail", "search")) !== first);
});
