// lophn_save tool 테스트다(mcp#R13–R15, R6, R7; connection#R10). registry의 tool 입력이
// 모르는 필드(폐지 소속·원본 파일 이동·옛 저장 종류)를 실행 전에 거절하는지, 서버를 거친
// tool 호출의 성공·실패 표현, 경로가 제출 root 안에서 다시 검사되는지를 본다. core 대신
// route별로 답을 정한 흐름 client를 쓴다.
import { assert, assertEquals } from "@std/assert";
import { createHandler } from "../server.ts";
import { resolveRoute } from "../registry.ts";
import {
  fail,
  preparedFor,
  savedResult,
  scriptedFlow,
  SERIES_ID,
  workspace,
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

const PATHS = ["notes/plan.md", "notes/extra.txt"];

Deno.test("coding-agent/mcp-server#R13: 경로 묶음과 제목·format·series·key를 받고 series만 있고 key가 없으면 거절한다", () => {
  assert(accepts({ paths: PATHS, title: "계획" }));
  assert(accepts({ paths: PATHS, series: { series: SERIES_ID }, key: "2" }));
  assert(!accepts({ paths: PATHS, series: { series: SERIES_ID } }));
  assert(!accepts({ paths: [] }));
  assert(!accepts({ paths: ["a.md", "a.md"] }));
  // 호출자는 blob 참조를 주장하지 않는다.
  assert(!accepts({ files: [{ path: "a.md" }] }));
});

Deno.test("coding-agent/mcp-server#R14: 옛 저장 종류 입력은 거절한다", () => {
  for (const old of ["report", "note", "plan"]) {
    assert(!accepts({ paths: PATHS, kind: old }), old);
    assert(!accepts({ paths: PATHS, type: old }), old);
  }
});

Deno.test("coding-agent/mcp-server#R15: 폐지 소속 입력과 원본 파일 이동·제거 요청은 거절한다", () => {
  for (
    const extra of [
      { context: "ctx_01arz3ndektsv4rrffq69g5fav" },
      { contexts: ["x"] },
      { move_original: true },
      { source_path: "/home/user/plan.md" },
      { delete_original: true },
      { tags: ["a"] },
      { note: "메모" },
    ]
  ) {
    assert(!accepts({ paths: PATHS, ...extra }), JSON.stringify(extra));
  }
});

function server(
  flow: ReturnType<typeof scriptedFlow>,
  where: Awaited<ReturnType<typeof workspace>>,
) {
  const save = createSaveTool({
    client: flow.client,
    scope: where.scope,
    prepareBytes: where.prepareBytes,
  });
  return createHandler({
    callTool: (name, args) => save(name, saveRoute(), args),
  });
}

function callSave(args: unknown, id: number) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "lophn_save", arguments: args },
  });
}

Deno.test("coding-agent/mcp-server#R13: tool 호출은 제출 root의 파일을 첫 경로 primary로 보내 저장하고 두 표현으로 낸다", async () => {
  const where = await workspace();
  try {
    const flow = scriptedFlow({
      "document.list": { documents: [], next_cursor: null },
      "document.prepare": preparedFor,
      "document.save": (input) =>
        savedResult("saved", (input as { document: string }).document),
    });
    const reply = await server(flow, where)(callSave({
      paths: PATHS,
      place: { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fav" },
      slug: "plan",
    }, 1));
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
    // 상대 경로는 제출 root 아래 파일이고 첫 파일이 primary다.
    const prepare = flow.calls("document.prepare")[0].input as {
      files: { path: string; primary: boolean; media_type: string }[];
    };
    assertEquals(
      prepare.files.map((file) => [file.path, file.primary, file.media_type]),
      [["plan.md", true, "text/markdown"], ["extra.txt", false, "text/plain"]],
    );
    assertEquals(where.prepared, ["plan.md", "extra.txt"]);
  } finally {
    await where.cleanup();
  }
});

Deno.test("coding-agent/connection#R10: 제출 root 밖·금지 영역으로 이어진 경로는 bytes를 보내기 전에 isError로 거절한다", async () => {
  const where = await workspace();
  try {
    await Deno.symlink(
      `${where.data}/ledger.sqlite`,
      `${where.scope.root}/notes/looks-like-source.md`,
    );
    const flow = scriptedFlow({});
    const handler = server(flow, where);
    for (
      const path of [
        "notes/looks-like-source.md",
        "notes/missing.md",
        "../outside.md",
      ]
    ) {
      // `..`는 입력 schema가, 나머지는 realpath 재검사가 막는다. 어느 쪽도 core에 닿지 않는다.
      const reply = await handler(
        callSave({ paths: ["notes/plan.md", path] }, 2),
      );
      const result = (reply as { result: { isError?: boolean } }).result;
      assertEquals(result.isError, true, path);
    }
    assertEquals(where.prepared, []);
    assertEquals(flow.sent.length, 0);
    // 같은 거절 문구다: 없는 파일과 금지 영역 파일을 구별하지 않는다.
    const link = await handler(
      callSave({ paths: ["notes/looks-like-source.md"] }, 3),
    );
    const missing = await handler(callSave({ paths: ["notes/missing.md"] }, 4));
    const summary = (value: unknown) =>
      (value as { result: { structuredContent: { summary: string } } }).result
        .structuredContent.summary;
    assertEquals(summary(link), summary(missing));
  } finally {
    await where.cleanup();
  }
});

Deno.test("coding-agent/mcp-server#R14: 명시 format 부적합은 isError로 전달하고 저장하지 않는다", async () => {
  const where = await workspace();
  try {
    const flow = scriptedFlow({
      "document.prepare": fail(
        "invalid_input",
        "requested format failed validation",
      ),
    });
    const reply = await server(flow, where)(callSave({
      paths: ["notes/plan.md"],
      format: { name: "document", module_hash: "c".repeat(64), explicit: true },
    }, 5));
    const result = (reply as { result: Record<string, unknown> }).result as {
      structuredContent: { summary: string; data: { code: string } };
      isError?: boolean;
    };
    assertEquals(result.isError, true);
    assertEquals(result.structuredContent.data.code, "invalid_input");
    assertEquals(flow.calls("document.save").length, 0);
  } finally {
    await where.cleanup();
  }
});

Deno.test("coding-agent/mcp-server#R6: 모르는 필드는 실행 전에 isError로 거절하고 core를 부르지 않는다", async () => {
  const where = await workspace();
  try {
    const flow = scriptedFlow({});
    const reply = await server(flow, where)(
      callSave({ paths: ["notes/plan.md"], move_original: true }, 6),
    );
    assertEquals(
      (reply as { result: { isError?: boolean } }).result.isError,
      true,
    );
    assertEquals(flow.sent.length, 0);
    assertEquals(where.prepared, []);
  } finally {
    await where.cleanup();
  }
});
