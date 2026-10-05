// lophn_format tool 테스트다(mcp#R14). 목록은 media type으로 거르고, show는 선언·
// 작성 안내를 그대로 내며, validate는 입력 hash와 명시 여부를 tool이 정해 format 실행
// route로 보내고 page를 끝까지 모은다. core에 닿지 않는다.
import { assert, assertEquals } from "@std/assert";
import { resolveRoute } from "../registry.ts";
import { canonicalFilesHash, type HashedFile } from "../../connection/mod.ts";
import {
  fail,
  FORMAT_HASH,
  scriptedFlow,
  type Workspace,
  workspace,
} from "../../connection/testing/mod.ts";
import { createFormatTool } from "./format.ts";

const DECLARATIONS = [
  { name: "data", media_types: ["*/*"] },
  { name: "document", media_types: ["text/markdown", "text/html"] },
  { name: "pdf", media_types: ["application/pdf"] },
  { name: "image", media_types: ["image/*"] },
].map((declaration) => ({
  ...declaration,
  module_hash: FORMAT_HASH,
  extracts: declaration.name !== "data",
  guide: { text: "안내", examples: [] },
}));

// list·show는 파일을 읽지 않는다. validate만 제출 root와 bytes 제출 통로를 쓴다.
const NO_FILES = {
  scope: { root: "/nonexistent", forbidden: [] },
  prepareBytes: () => {
    throw new Error("list·show는 bytes를 보내지 않는다");
  },
};

function run(
  flow: ReturnType<typeof scriptedFlow>,
  input: Record<string, unknown>,
  where: Pick<Workspace, "scope" | "prepareBytes"> = NO_FILES,
) {
  const resolved = resolveRoute("lophn_format", input.op as string);
  assert(resolved);
  return createFormatTool({
    client: flow.client,
    scope: where.scope,
    prepareBytes: where.prepareBytes,
  })("lophn_format", resolved.route, input);
}

Deno.test("coding-agent/mcp-server#R14: format 목록은 media type에 맞는 선언을 구체적인 것부터 낸다", async () => {
  const flow = scriptedFlow({ "format.list": { formats: DECLARATIONS } });
  const all = await run(flow, { op: "list" });
  assertEquals(
    (all.data as { formats: { name: string }[] }).formats.map((f) => f.name),
    ["document", "pdf", "image", "data"],
  );
  const png = await run(flow, { op: "list", media_type: "image/png" });
  assertEquals(
    (png.data as { formats: { name: string }[] }).formats.map((f) => f.name),
    ["image", "data"],
  );
  const md = await run(flow, { op: "list", media_type: "text/markdown" });
  assertEquals(
    (md.data as { formats: { name: string }[] }).formats.map((f) => f.name),
    ["document", "data"],
  );
  // 목록은 이름·hash·형식만 낸다. 선언 본문은 show에서 읽는다.
  assertEquals(
    Object.keys((all.data as { formats: object[] }).formats[0]).sort(),
    ["extracts", "media_types", "module_hash", "name"],
  );
  // route에는 op를 떼고 빈 입력만 갔다.
  assertEquals(flow.calls("format.list")[0].input, {});
});

Deno.test("coding-agent/mcp-server#R14: show는 선언과 작성 안내를 그대로 낸다", async () => {
  const flow = scriptedFlow({ "format.get": DECLARATIONS[1] });
  const shown = await run(flow, {
    op: "show",
    name: "document",
    module_hash: FORMAT_HASH,
  });
  assertEquals((shown.data as { guide: { text: string } }).guide.text, "안내");
  assertEquals(flow.calls("format.get")[0].input, {
    name: "document",
    module_hash: FORMAT_HASH,
  });
  assertEquals(shown.isError, undefined);
});

Deno.test("coding-agent/mcp-server#R14: 없는 format 이름은 소유 route의 오류를 그대로 isError로 낸다", async () => {
  const flow = scriptedFlow({
    "format.get": fail("not_found", "format not found"),
  });
  const shown = await run(flow, {
    op: "show",
    name: "document",
    module_hash: FORMAT_HASH,
  });
  assertEquals(shown.isError, true);
  assertEquals((shown.data as { code: string }).code, "not_found");
});

Deno.test("coding-agent/mcp-server#R14: validate는 경로를 제출 root에서 읽어 입력 hash와 명시 여부를 tool이 정하고 진단을 끝까지 모은다", async () => {
  const where = await workspace();
  try {
    const error = {
      severity: "error",
      code: "invalid_structure",
      message: "heading이 없다",
      file: "plan.md",
      start_line: 3,
      end_line: 3,
      column: 1,
    };
    const warning = { ...error, severity: "warning", message: "긴 줄" };
    const pages = [
      {
        input_hash: "a".repeat(64),
        module_hash: FORMAT_HASH,
        status: "failed",
        error_count: 1,
        warning_count: 1,
        diagnostics_offset: 0,
        diagnostics: [error],
        complete: false,
        next_cursor: "c1",
      },
      {
        input_hash: "a".repeat(64),
        module_hash: FORMAT_HASH,
        status: "failed",
        error_count: 1,
        warning_count: 1,
        diagnostics_offset: 1,
        diagnostics: [warning],
        complete: true,
        next_cursor: null,
      },
    ];
    let page = 0;
    const flow = scriptedFlow({ "format.validate": () => pages[page++] });
    const result = await run(flow, {
      op: "validate",
      name: "document",
      module_hash: FORMAT_HASH,
      paths: ["notes/plan.md", "notes/extra.txt"],
    }, where);
    const calls = flow.calls("format.validate").map((call) =>
      call.input as {
        explicit: boolean;
        input_hash: string;
        cursor?: string;
        op?: string;
        paths?: unknown;
        files: (HashedFile & { content: unknown })[];
      }
    );
    assertEquals(calls.length, 2);
    // route에는 op·paths가 가지 않고 준비된 files가 간다. 첫 파일이 primary다.
    assertEquals(calls[0].op, undefined);
    assertEquals(calls[0].paths, undefined);
    assertEquals(
      calls[0].files.map((file) => [file.path, file.primary]),
      [["plan.md", true], ["extra.txt", false]],
    );
    assertEquals(calls[0].explicit, true);
    assertEquals(
      calls[0].input_hash,
      await canonicalFilesHash(calls[0].files),
    );
    assertEquals(calls[0].cursor, undefined);
    assertEquals(calls[1].cursor, "c1");
    const data = result.data as {
      status: string;
      diagnostics: { severity: string; file: string; start_line: number }[];
      complete: boolean;
    };
    assertEquals(data.status, "failed");
    assertEquals(data.complete, true);
    assertEquals(data.diagnostics.map((d) => d.severity), ["error", "warning"]);
    assertEquals(data.diagnostics[0].file, "plan.md");
    assertEquals(data.diagnostics[0].start_line, 3);
    // 검사 결과 failed는 tool 실패가 아니다. 판 수는 늘지 않았다(저장 route 호출 없음).
    assertEquals(result.isError, undefined);
    assertEquals(
      flow.sent.every((call) => call.name === "format.validate"),
      true,
    );
  } finally {
    await where.cleanup();
  }
});

Deno.test("coding-agent/connection#R10: validate도 제출 root 밖·금지 영역 경로는 bytes를 보내기 전에 거절한다", async () => {
  const where = await workspace();
  try {
    await Deno.symlink(
      `${where.data}/ledger.sqlite`,
      `${where.scope.root}/notes/looks-like-source.md`,
    );
    const flow = scriptedFlow({});
    const result = await run(flow, {
      op: "validate",
      name: "document",
      module_hash: FORMAT_HASH,
      paths: ["notes/looks-like-source.md"],
    }, where);
    assertEquals(result.isError, true);
    assertEquals(result.summary, "제출할 수 없는 파일이다");
    assertEquals(where.prepared, []);
    assertEquals(flow.sent.length, 0);
  } finally {
    await where.cleanup();
  }
});

Deno.test("coding-agent/mcp-server#R14: validate 입력에는 호출자가 주장하는 blob 참조·hash·explicit·cursor가 없다", () => {
  const resolved = resolveRoute("lophn_format", "validate");
  assert(resolved);
  const base = {
    op: "validate",
    name: "document",
    module_hash: FORMAT_HASH,
    paths: ["notes/plan.md"],
  };
  assert(resolved.tool.input.safeParse(base).success);
  for (
    const claim of [
      { files: [] },
      { input_hash: "a".repeat(64) },
      { explicit: false },
      { cursor: "x" },
    ]
  ) {
    assert(!resolved.tool.input.safeParse({ ...base, ...claim }).success);
  }
});
