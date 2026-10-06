// lophn_index tool 테스트다(mcp#R8). op마다 소유 읽기 route 하나로 보내고 잘림·반영 지연·
// 새 판·구역 없음·추출 실패를 요약에 밝힌다. 구역 없는 section op는 문서 목차로 추측하지
// 않는다. 쓰는 op는 없다. core에 닿지 않는다.
import { assert, assertEquals } from "@std/assert";
import { resolveRoute } from "../registry.ts";
import { fail, scriptedFlow } from "../../connection/testing/mod.ts";
import { createIndexTool } from "./index.ts";

const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const V1 = "ver_01arz3ndektsv4rrffq69g5fav";
const V2 = "ver_01arz3ndektsv4rrffq69g5faw";
const PLACE = { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fav" };

function run(
  flow: ReturnType<typeof scriptedFlow>,
  input: Record<string, unknown>,
) {
  const resolved = resolveRoute("lophn_index", input.op as string);
  assert(resolved, `resolve ${input.op}`);
  return createIndexTool({ client: flow.client })(
    "lophn_index",
    resolved.route,
    input,
  );
}

const COVERED = {
  processed_seq: "3",
  ledger_basis_seq: "3",
  lagging: false,
  rebuilding: false,
  omissions: [],
};
const LAGGING = {
  processed_seq: "2",
  ledger_basis_seq: "5",
  lagging: true,
  rebuilding: false,
  omissions: [{ document: DOC, version: V1, reason: "too large" }],
};

Deno.test("coding-agent/mcp-server#R8: op마다 소유 읽기 route 하나로 보내고 op는 route 입력에 없다", async () => {
  const flow = scriptedFlow({
    "outline.root": { entries: [], complete: true, next_cursor: null },
    "outline.place": {
      entries: [],
      coverage: COVERED,
      complete: true,
      next_cursor: null,
    },
    "search.query": {
      results: [],
      coverage: COVERED,
      complete: true,
      next_cursor: null,
    },
    "search.status": { documents: [], coverage: COVERED, next_cursor: null },
  });
  await run(flow, { op: "root", estimated_token_budget: 1500 });
  await run(flow, { op: "place", place: PLACE });
  await run(flow, { op: "search", query: "계획", place: PLACE });
  await run(flow, { op: "status" });
  assertEquals(flow.sent.map((call) => call.name), [
    "outline.root",
    "outline.place",
    "search.query",
    "search.status",
  ]);
  for (const call of flow.sent) {
    assertEquals(call.kind, "read");
    assertEquals("op" in (call.input as object), false);
  }
});

Deno.test("coding-agent/mcp-server#R8: 반영 지연·재생성·누락을 요약에 밝히고 지연 중 빈 검색을 완전한 답으로 내지 않는다", async () => {
  const flow = scriptedFlow({
    "search.query": {
      results: [],
      coverage: LAGGING,
      complete: true,
      next_cursor: null,
    },
    "outline.place": {
      entries: [{}],
      coverage: { ...LAGGING, lagging: false, rebuilding: true, omissions: [] },
      complete: true,
      next_cursor: null,
    },
  });
  const search = await run(flow, { op: "search", query: "계획" });
  assert(search.summary.includes("반영 지연(처리 2/장부 5)"), search.summary);
  assert(search.summary.includes("판 1개는 이유와 함께 누락"), search.summary);
  assert(search.summary.includes("없다는 뜻이 아니다"), search.summary);
  assert(
    search.next.some((line) => line.includes("lophn_index status")),
    search.next.join("|"),
  );
  const place = await run(flow, { op: "place", place: PLACE });
  assert(place.summary.includes("다시 만드는 중"), place.summary);
});

Deno.test("coding-agent/mcp-server#R8: 잘림은 생략 수와 이어 읽기 cursor로 밝힌다", async () => {
  const flow = scriptedFlow({
    "outline.root": {
      entries: [{ kind: "project" }, { kind: "project" }, { kind: "unplaced" }],
      complete: false,
      next_cursor: "cur",
      omitted: [{ reason: "byte_limit", count: 2 }],
    },
  });
  const root = await run(flow, { op: "root" });
  assert(root.summary.includes("project 2, unplaced 1"), root.summary);
  assert(root.summary.includes("크기 한도로 2개 생략"), root.summary);
  assert(root.summary.includes("이어 읽을 것이 더 있다"), root.summary);
});

Deno.test("coding-agent/mcp-server#R8: 문서 목차는 새 판·구역 없음·추출 실패·형식 미지원을 구별한다", async () => {
  const page = (over: Record<string, unknown>) => ({
    kind: "document",
    version: V1,
    latest_version: V1,
    section_status: "whole",
    failure_reason: null,
    file: null,
    entries: [
      { key: "a", hidden_children_count: 2 },
      { key: "b", hidden_children_count: 1 },
    ],
    complete: true,
    next_cursor: null,
    ...over,
  });
  const reference = { document: DOC, version: V1, section: null };
  const stale = await run(
    scriptedFlow({ "outline.document": page({ latest_version: V2 }) }),
    { op: "document", reference },
  );
  assert(stale.summary.includes("깊이 밖 하위 구역 3개"), stale.summary);
  assert(stale.summary.includes(`최신 판(${V2})이 아니다`), stale.summary);
  const missing = await run(
    scriptedFlow({
      "outline.document": page({ section_status: "missing", entries: [] }),
    }),
    { op: "section", reference: { ...reference, section: "x" } },
  );
  assert(missing.summary.includes("고른 구역이 이 판에 없다"), missing.summary);
  const file = { version: V1, path: "a.pdf" };
  const unverified = await run(
    scriptedFlow({
      "outline.document": page({
        section_status: "unverified",
        failure_reason: "timeout",
        file,
        entries: [],
      }),
    }),
    { op: "document", reference },
  );
  assert(unverified.summary.includes("확인하지 못했다(timeout)"));
  assertEquals(unverified.isError, undefined);
  const unsupported = await run(
    scriptedFlow({
      "outline.document": page({
        section_status: "unsupported",
        file,
        entries: [],
      }),
    }),
    { op: "document", reference },
  );
  assert(unsupported.summary.includes("지원하지 않는다"));
});

Deno.test("coding-agent/mcp-server#R8: 구역 없는 section op는 문서 목차로 추측하지 않고 route를 부르지 않는다", async () => {
  const flow = scriptedFlow({});
  const result = await run(flow, {
    op: "section",
    reference: { document: DOC, version: V1, section: null },
  });
  assertEquals(result.isError, true);
  assertEquals(flow.sent.length, 0);
});

Deno.test("coding-agent/mcp-server#R8: 읽기 오류는 isError로 그대로 오고 표 밖 op는 실행하지 않는다", async () => {
  const flow = scriptedFlow({
    "outline.place": () => fail("not_found", "place not found"),
  });
  const failed = await run(flow, { op: "place", place: PLACE });
  assertEquals(failed.isError, true);
  assertEquals(failed.summary, "place not found");
  const ghost = await createIndexTool({ client: flow.client })(
    "lophn_index",
    resolveRoute("lophn_index", "root")!.route,
    { op: "rebuild" },
  );
  assertEquals(ghost.isError, true);
  assertEquals(flow.sent.length, 1);
});
