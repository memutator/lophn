// lophn_save tool 테스트다(mcp#R13–R15, R6, R7). registry의 소유 route 입력이 모르는
// 필드(폐지 소속·원본 파일 이동·옛 저장 종류)를 실행 전에 거절하는지, 서버를 거친
// tool 호출의 성공·실패 표현을 본다. core에 닿지 않는다.
import { assert, assertEquals } from "@std/assert";
import { createHandler } from "../server.ts";
import { resolveRoute } from "../registry.ts";
import {
  documentFiles,
  fail,
  preparedFor,
  savedResult,
  scriptedFlow,
  SERIES_ID,
} from "../../connection/testing/mod.ts";
import { createSaveTool } from "./save.ts";

function saveRoute() {
  const resolved = resolveRoute("lophn_save", undefined);
  assert(resolved);
  return resolved.route;
}

function accepts(input: unknown): boolean {
  return saveRoute().input.safeParse(input).success;
}

Deno.test("coding-agent/mcp-server#R13: 파일 묶음과 제목·format·series·key를 받고 series만 있고 key가 없으면 거절한다", () => {
  const files = documentFiles();
  assert(accepts({ files, title: "계획" }));
  assert(accepts({ files, series: { series: SERIES_ID }, key: "2" }));
  assert(!accepts({ files, series: { series: SERIES_ID } }));
  // 대표 파일이 하나가 아니거나 경로가 겹치면 거절한다.
  assert(
    !accepts({ files: files.map((file) => ({ ...file, primary: true })) }),
  );
  assert(!accepts({ files: [] }));
});

Deno.test("coding-agent/mcp-server#R14: 옛 저장 종류 입력은 거절한다", () => {
  const files = documentFiles();
  for (const old of ["report", "note", "plan"]) {
    assert(!accepts({ files, kind: old }), old);
    assert(!accepts({ files, type: old }), old);
  }
});

Deno.test("coding-agent/mcp-server#R15: 폐지 소속 입력과 원본 파일 이동·제거 요청은 거절한다", () => {
  const files = documentFiles();
  for (
    const extra of [
      { context: "ctx_01arz3ndektsv4rrffq69g5fav" },
      { contexts: ["x"] },
      { move_original: true },
      { source_path: "/home/user/plan.md" },
      { delete_original: true },
      { tags: ["a"] },
    ]
  ) {
    assert(!accepts({ files, ...extra }), JSON.stringify(extra));
  }
});

Deno.test("coding-agent/mcp-server#R13: tool 호출은 저장 결과를 summary와 data로 두 표현에 낸다", async () => {
  const flow = scriptedFlow({
    "document.list": { documents: [], next_cursor: null },
    "document.prepare": preparedFor,
    "document.save": (input) => ({
      result: savedResult("saved", (input as { document: string }).document),
      replayed: false,
      first_seq: "7",
      last_seq: "7",
    }),
  });
  const save = createSaveTool({ client: flow.client });
  const handler = createHandler({
    callTool: (name, args) => save(name, saveRoute(), args),
  });
  const reply = await handler(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "lophn_save",
      arguments: {
        files: documentFiles(),
        place: { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fav" },
        slug: "plan",
      },
    },
  }));
  const result = (reply as { result: Record<string, unknown> }).result as {
    structuredContent: { summary: string; data: { address: string } };
    content: { text: string }[];
    isError?: boolean;
  };
  assertEquals(result.isError, undefined);
  assertEquals(result.structuredContent.data.address, "notes/plan@1");
  assertEquals(
    JSON.parse(result.content[0].text).summary,
    result.structuredContent.summary,
  );
});

Deno.test("coding-agent/mcp-server#R14: 명시 format 부적합은 isError로 전달하고 저장하지 않는다", async () => {
  const flow = scriptedFlow({
    "document.prepare": fail(
      "invalid_input",
      "requested format failed validation",
    ),
  });
  const save = createSaveTool({ client: flow.client });
  const handler = createHandler({
    callTool: (name, args) => save(name, saveRoute(), args),
  });
  const reply = await handler(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "lophn_save",
      arguments: {
        files: documentFiles(),
        format: {
          name: "document",
          module_hash: "c".repeat(64),
          explicit: true,
        },
      },
    },
  }));
  const result = (reply as { result: Record<string, unknown> }).result as {
    structuredContent: { summary: string; data: { code: string } };
    isError?: boolean;
  };
  assertEquals(result.isError, true);
  assertEquals(result.structuredContent.data.code, "invalid_input");
  assertEquals(flow.calls("document.save").length, 0);
});

Deno.test("coding-agent/mcp-server#R6: 모르는 필드는 실행 전에 isError로 거절하고 core를 부르지 않는다", async () => {
  const flow = scriptedFlow({});
  const save = createSaveTool({ client: flow.client });
  const handler = createHandler({
    callTool: (name, args) => save(name, saveRoute(), args),
  });
  const reply = await handler(JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "lophn_save",
      arguments: { files: documentFiles(), move_original: true },
    },
  }));
  assertEquals(
    (reply as { result: { isError?: boolean } }).result.isError,
    true,
  );
  assertEquals(flow.sent.length, 0);
});
