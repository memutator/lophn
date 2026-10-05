// lophn_context tool 테스트다(mcp#R17, cli#R18·R19). 읽기 op는 소유 route 하나로만 보내고
// propose는 변경안 문서 저장뿐인지, 입력은 실행 전에 tool 표로 검사되는지, 오류가 isError로
// 응답에 닿는지를 본다. core 대신 route별로 답을 정한 흐름 client를 쓴다: 답을 정하지 않은
// route(context·term command)를 부르면 테스트가 실패한다.
import { assert, assertEquals } from "@std/assert";
import { ok } from "../../../base/mod.ts";
import { MCP_DECISION_TOOLS } from "../../../contracts/coding-agent/mod.ts";
import { createHandler } from "../server.ts";
import { resolveRoute } from "../registry.ts";
import {
  fail,
  preparedFor,
  savedResult,
  scriptedFlow,
} from "../../connection/testing/mod.ts";
import { type PrepareBytes, PROPOSAL_SCHEMA } from "../../connection/mod.ts";
import { createContextTool } from "./context.ts";

const CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fav";
const ARCHIVED = "ctx_01arz3ndektsv4rrffq69g5faw";
const NEW_CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fax";
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const VERSION = "ver_01arz3ndektsv4rrffq69g5fav";
const TERM = "trm_01arz3ndektsv4rrffq69g5fav";
const REVISION = "4";

const READ = { complete: true, as_of_seq: "9", next_cursor: null };
const docTarget = { kind: "document", document: DOC, section: null };
const sectionTarget = { kind: "document", document: DOC, section: "문서" };

function contextRow(over: Record<string, unknown> = {}) {
  return {
    id: CONTEXT,
    title: "판단 묶음",
    purpose: "용어를 판단할 때 읽는다",
    items: [
      { target: sectionTarget, perspective: "basis", reason: "기준" },
      { target: docTarget, perspective: "watch", reason: "변경 감시" },
    ],
    revision: REVISION,
    status: "active",
    ...over,
  };
}

// propose가 보낸 바이트를 모아 문서 본문을 확인한다.
function capture() {
  const bodies: string[] = [];
  const prepareBytes: PrepareBytes = async (file) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of file.open()) chunks.push(chunk);
    bodies.push(new TextDecoder().decode(chunks[0]));
    return ok({
      preparation: `prep-${bodies.length}`,
      principal: "cac",
      purpose: "document_file",
      hash: file.blob_hash,
      size_bytes: file.bytes,
    });
  };
  return { bodies, prepareBytes };
}

function setup(handlers: Parameters<typeof scriptedFlow>[0]) {
  const flow = scriptedFlow(handlers);
  const bytes = capture();
  const tool = createContextTool({
    client: flow.client,
    prepareBytes: bytes.prepareBytes,
  });
  return {
    flow,
    bytes,
    run(input: Record<string, unknown>) {
      const resolved = resolveRoute("lophn_context", input.op as string);
      assert(resolved);
      return tool("lophn_context", resolved.route, input);
    },
  };
}

const saveHandlers = {
  "context.get": { ...READ, context: contextRow() },
  "document.prepare": preparedFor,
  "document.save": (input: unknown) =>
    savedResult("saved", (input as { document: string }).document),
};

function accepts(input: unknown): boolean {
  const tool = MCP_DECISION_TOOLS.find((item) => item.name === "lophn_context");
  assert(tool);
  return tool.input.safeParse(input).success;
}

Deno.test("coding-agent/mcp-server#R17: 읽기 op는 소유 읽기 route 하나로 보내고 op를 떼어 보내며 context가 소속이 아님을 알린다", async () => {
  const { flow, run } = setup({
    "context.list": {
      ...READ,
      contexts: [
        contextRow(),
        contextRow({ id: ARCHIVED, status: "archived" }),
      ],
    },
    "context.get": { ...READ, context: contextRow() },
    "context.related": { ...READ, contexts: [contextRow()] },
  });
  const listed = await run({ op: "list", status: "all" });
  assertEquals(listed.isError, undefined);
  // 보관 포함 목록이다. status all이 owner route 입력으로 간다.
  assertEquals(flow.calls("context.list")[0].input, { status: "all" });
  assertEquals(listed.summary.includes("보관 1개 포함"), true);
  assertEquals(listed.summary.includes("소속이 아니라 읽는 관점"), true);
  const shown = await run({ op: "show", context: CONTEXT });
  assertEquals(
    shown.summary.startsWith("판단 묶음: 기준 1·참고 0·watch 1"),
    true,
  );
  assertEquals(flow.calls("context.get")[0].input, { context: CONTEXT });
  const related = await run({ op: "of", target: docTarget });
  assertEquals(
    related.summary.startsWith("이 대상을 참조하는 context 1개"),
    true,
  );
  assertEquals(flow.calls("context.related")[0].input, { target: docTarget });
  // 읽기는 읽기 route만 보냈다.
  assertEquals(flow.sent.every((call) => call.kind === "read"), true);
});

Deno.test("coding-agent/mcp-server#R17: items는 perspective를 소유 route에 보내지 않고 선택한 관점만 남기며 읽기 깊이를 그대로 넘긴다", async () => {
  const entry = (perspective: string, target: unknown) => ({
    kind: "document",
    perspective,
    reason: "이유",
    title: "문서",
    readable: true,
    target,
    version: VERSION,
    latest_version: VERSION,
    format: null,
    module_hash: null,
    section_status: "whole",
  });
  const basis = entry("basis", sectionTarget);
  const watch = entry("watch", docTarget);
  const { flow, run } = setup({
    "outline.context": {
      ...READ,
      kind: "context",
      context: CONTEXT,
      title: "판단 묶음",
      purpose: "p",
      entries: [basis, watch],
      perspectives: { basis: [basis], reference: [], watch: [watch] },
      glossary: [],
      candidates: [],
    },
  });
  const all = await run({ op: "items", context: CONTEXT });
  assertEquals(
    all.summary.startsWith("판단 묶음: 기준 1·참고 0·watch 1"),
    true,
  );
  const only = await run({
    op: "items",
    context: CONTEXT,
    perspective: "watch",
    estimated_token_budget: 500,
    cursor: "1",
  });
  const data = only.data as {
    entries: { perspective: string }[];
    perspectives: Record<string, unknown[]>;
  };
  assertEquals(data.entries.map((item) => item.perspective), ["watch"]);
  assertEquals(Object.keys(data.perspectives), ["watch"]);
  assertEquals(flow.calls("outline.context")[1].input, {
    context: CONTEXT,
    estimated_token_budget: 500,
    cursor: "1",
  });
});

Deno.test("coding-agent/mcp-server#R17: glossary는 정의와 후보를 구별하고 정의 확정은 사람 몫이라고 안내한다", async () => {
  const { flow, run } = setup({
    "term.list": {
      ...READ,
      definitions: [{ id: TERM, name: "범위", definition: "대상" }],
      candidates: [
        { id: TERM, name: "경계", definition: null },
        { id: TERM, name: "한계", definition: null },
      ],
    },
  });
  const result = await run({ op: "glossary", context: CONTEXT });
  assertEquals(result.summary.startsWith("용어 정의 1개, 후보 2개"), true);
  assertEquals(result.next[0].includes("정의 확정은 사람이 한다"), true);
  assertEquals(flow.calls("term.list")[0].input, { context: CONTEXT });
});

const SECTION_ITEM = {
  target: { kind: "document", document: DOC, section: "추가" },
  perspective: "reference",
  reason: "추가로 참고한다",
};
const CHANGES: Record<string, unknown>[] = [
  {
    kind: "create",
    id: NEW_CONTEXT,
    title: "새 묶음",
    purpose: "새 관점",
    items: [],
  },
  { kind: "rename", context: CONTEXT, title: "새 이름" },
  { kind: "set_item", context: CONTEXT, item: SECTION_ITEM },
  {
    kind: "set_item",
    context: CONTEXT,
    item: { target: sectionTarget, perspective: "watch", reason: "바꾼다" },
  },
  { kind: "remove_item", context: CONTEXT, target: sectionTarget },
  {
    kind: "term_propose",
    id: TERM,
    context: CONTEXT,
    name: "용어",
    evidence: [{
      document: DOC,
      version: VERSION,
      section: "문서",
      start_line: null,
      end_line: null,
    }],
  },
  { kind: "term_update", term: TERM, definition: "다른 정의" },
];

Deno.test("coding-agent/mcp-server#R17: 생성·이름 변경·항목 추가와 제거·관점 변경·용어 추가와 채택 변경이 변경안 문서로만 남고 context·용어 command는 부르지 않는다", async () => {
  const labels: string[] = [];
  for (const change of CHANGES) {
    // create는 아직 없는 context라 읽기가 not_found다.
    const handlers = change.kind === "create"
      ? {
        ...saveHandlers,
        "context.get": fail("not_found", "context not found"),
      }
      : saveHandlers;
    const { flow, bytes, run } = setup(handlers);
    const result = await run({
      op: "propose",
      change,
      reason: "이유를 적는다",
      idempotency_key: `key-${labels.length}`,
    });
    assertEquals(result.isError, undefined, JSON.stringify(result.data));
    // 부른 route는 대상 읽기와 변경안 문서 준비·저장뿐이다.
    const names = new Set(flow.sent.map((call) => call.name));
    for (const name of names) {
      assert(
        ["context.get", "document.prepare", "document.save"].includes(name),
        name,
      );
    }
    assertEquals(
      flow.sent.some((call) =>
        call.kind === "command" && call.name !== "document.save"
      ),
      false,
    );
    assertEquals(flow.calls("document.save").length, 1);
    // 변경안·이유가 문서 bytes에 그대로 남는다.
    const body = bytes.bodies[0];
    assertEquals(body.includes(PROPOSAL_SCHEMA), true);
    assertEquals(body.includes("이유를 적는다"), true);
    const record = JSON.parse(
      body.slice(body.indexOf("````json\n") + 9, body.lastIndexOf("\n````")),
    ) as { kind: string; change: unknown; reason: string };
    assertEquals(record.kind, change.kind);
    assertEquals(record.change, change);
    assertEquals(record.reason, "이유를 적는다");
    const data = result.data as {
      applied: boolean;
      run_created: boolean;
      question_created: boolean;
      proposal: { address: string };
      item_effect: string | null;
    };
    assertEquals(data.applied, false);
    assertEquals(data.run_created, false);
    assertEquals(data.question_created, false);
    assertEquals(result.summary.includes(data.proposal.address), true);
    assertEquals(result.summary.includes("Context Engineer"), true);
    assertEquals(result.next[0].includes("Context Engineer"), true);
    // 저장 key는 호출자가 준 key다.
    assertEquals(
      flow.calls("document.save")[0].idempotency_key,
      `key-${labels.length}`,
    );
    labels.push(`${change.kind}:${data.item_effect}`);
  }
  // 같은 set_item이라도 이미 있는 항목이면 관점 변경, 없으면 항목 추가다.
  assertEquals(labels, [
    "create:null",
    "rename:null",
    "set_item:add_item",
    "set_item:change_item",
    "remove_item:null",
    "term_propose:null",
    "term_update:null",
  ]);
});

Deno.test("coding-agent/mcp-server#R17: 폴더·untracked 파일 항목과 분할·병합·정의 직접 변경·보관 제안은 실행 전 거절하고 아무것도 보내지 않는다", async () => {
  const base = { op: "propose", reason: "이유" };
  const itemWith = (target: unknown) => ({
    kind: "set_item",
    context: CONTEXT,
    item: { target, perspective: "basis", reason: "읽는다" },
  });
  for (
    const target of [
      { kind: "folder", path: "/home/me/project" },
      { kind: "file", path: "notes/untracked.md" },
      { kind: "document", document: "/home/me/notes.md", section: null },
    ]
  ) {
    assertEquals(accepts({ ...base, change: itemWith(target) }), false);
    // tool 실행기에 직접 줘도 거절하고 core에 아무것도 보내지 않는다.
    const { flow, run } = setup({});
    const result = await run({ ...base, change: itemWith(target) });
    assertEquals(result.isError, true);
    assertEquals(result.summary.includes("폴더나 untracked 파일"), true);
    assertEquals(flow.sent.length, 0);
  }
  for (
    const kind of [
      "split",
      "merge",
      "define",
      "archive",
      "unarchive",
      "term_define",
      "term_archive",
    ]
  ) {
    assertEquals(
      accepts({ ...base, change: { kind, context: CONTEXT } }),
      false,
      kind,
    );
  }
  // 이유가 없거나 비면 접수하지 않는다.
  assertEquals(
    accepts({ op: "propose", change: CHANGES[1] }),
    false,
  );
  assertEquals(
    accepts({ op: "propose", change: CHANGES[1], reason: "  " }),
    false,
  );
});

Deno.test("coding-agent/mcp-server#R17: 없거나 범위 밖인 context와 이미 있는 id·없는 항목은 context를 바꾸지 않고 거절한다", async () => {
  const absent = setup({
    "context.get": fail("not_found", "context not found"),
  });
  const rename = { kind: "rename", context: CONTEXT, title: "새 이름" };
  const refused = await absent.run({
    op: "propose",
    change: rename,
    reason: "이유",
  });
  assertEquals(refused.isError, true);
  assertEquals((refused.data as { code: string }).code, "not_found");
  assertEquals(absent.flow.calls("document.save").length, 0);
  assertEquals(absent.bytes.bodies.length, 0);

  const taken = setup(saveHandlers);
  const exists = await taken.run({
    op: "propose",
    change: { ...CHANGES[0], id: CONTEXT },
    reason: "이유",
  });
  assertEquals(exists.isError, true);
  assertEquals((exists.data as { code: string }).code, "conflict");
  assertEquals(taken.flow.calls("document.save").length, 0);

  const missingItem = setup(saveHandlers);
  const gone = await missingItem.run({
    op: "propose",
    change: {
      kind: "remove_item",
      context: CONTEXT,
      target: { kind: "document", document: DOC, section: "없는 구역" },
    },
    reason: "이유",
  });
  assertEquals(gone.isError, true);
  assertEquals((gone.data as { code: string }).code, "not_found");
  assertEquals(missingItem.flow.calls("document.save").length, 0);
});

Deno.test("coding-agent/mcp-server#R17: 표에 없는 op는 실행하지 않고 propose의 route는 문서 저장 하나뿐이다", async () => {
  const tool = MCP_DECISION_TOOLS.find((item) => item.name === "lophn_context");
  assert(tool);
  assertEquals([...tool.ops], [
    "list",
    "show",
    "items",
    "glossary",
    "of",
    "propose",
  ]);
  for (const op of ["create", "update", "archive", "set_item", "apply"]) {
    assertEquals(resolveRoute("lophn_context", op), undefined);
  }
  assertEquals(
    resolveRoute("lophn_context", "propose")?.route.name,
    "document.save",
  );
  const { flow, run } = setup({});
  const direct = await createContextTool({
    client: flow.client,
    prepareBytes: capture().prepareBytes,
  })(
    "lophn_context",
    resolveRoute("lophn_context", "list")!.route,
    { op: "create", id: CONTEXT },
  );
  assertEquals(direct.isError, true);
  assertEquals(flow.sent.length, 0);
  void run;
});

function server(flow: ReturnType<typeof setup>) {
  const tool = createContextTool({
    client: flow.flow.client,
    prepareBytes: flow.bytes.prepareBytes,
  });
  return createHandler({
    callTool: (name, args) => {
      const resolved = resolveRoute(
        name,
        (args as { op?: string } | undefined)?.op,
      );
      assert(resolved);
      return tool(name, resolved.route, args);
    },
  });
}

function call(args: unknown, id: number) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "lophn_context", arguments: args },
  });
}

type CallResult = {
  structuredContent: { summary: string; data: unknown };
  content: { text: string }[];
  isError?: boolean;
};

Deno.test("coding-agent/mcp-server#R17: 서버를 거친 호출은 입력을 tool 표로 검사하고 성공·실패를 두 표현으로 낸다", async () => {
  const wired = setup({
    ...saveHandlers,
    "context.list": fail("unavailable", "core를 읽지 못했다"),
  });
  const handler = server(wired);
  // 성공한 propose는 isError가 없고 data에 주소가 있다.
  const okReply = await handler(call({
    op: "propose",
    change: CHANGES[1],
    reason: "이유",
  }, 1));
  const okResult = (okReply as { result: CallResult }).result;
  assertEquals(okResult.isError, undefined);
  assertEquals(
    (okResult.structuredContent.data as { applied: boolean }).applied,
    false,
  );
  assertEquals(
    JSON.parse(okResult.content[0].text).summary,
    okResult.structuredContent.summary,
  );

  // core 오류는 isError로 응답에 닿는다.
  const failed = await handler(call({ op: "list" }, 2));
  const failedResult = (failed as { result: CallResult }).result;
  assertEquals(failedResult.isError, true);
  assertEquals(failedResult.structuredContent.summary, "core를 읽지 못했다");

  // 표 밖 입력(분할·폴더 항목·모르는 필드)은 실행 전 isError라 route를 부르지 않는다.
  const before = wired.flow.sent.length;
  for (
    const args of [
      {
        op: "propose",
        change: { kind: "split", context: CONTEXT },
        reason: "r",
      },
      {
        op: "propose",
        change: {
          kind: "set_item",
          context: CONTEXT,
          item: {
            target: { kind: "folder", path: "/x" },
            perspective: "basis",
            reason: "r",
          },
        },
        reason: "r",
      },
      { op: "show", context: CONTEXT, definition: "직접 변경" },
      { op: "apply", change: CHANGES[1] },
    ]
  ) {
    const reply = await handler(call(args, 3));
    const result = (reply as { result: CallResult }).result;
    assertEquals(result.isError, true, JSON.stringify(args));
  }
  assertEquals(wired.flow.sent.length, before);
});

Deno.test("coding-agent/mcp-server#R17: 변경안 문서 저장이 실패하면 isError로 알리고 그 오류를 그대로 낸다", async () => {
  const wired = setup({
    ...saveHandlers,
    "document.save": fail("forbidden", "권한이 없다"),
  });
  const result = await wired.run({
    op: "propose",
    change: CHANGES[1],
    reason: "이유",
  });
  assertEquals(result.isError, true);
  assertEquals((result.data as { code: string }).code, "forbidden");
  assertEquals(result.summary, "권한이 없다");
});
