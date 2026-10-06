// lophn_document tool 테스트다(mcp#R11·R12). list는 본문 없는 목록과 이어 읽기를, history는
// 고정 판 목록과 구역 판별 변화를, diff는 줄 차이를 낸다. 모두 읽기 route뿐이고 비교는 같은
// key만 보며 rename을 추정하지 않는다. core에 닿지 않는다.
import { assert, assertEquals } from "@std/assert";
import { resolveRoute } from "../registry.ts";
import { fail, scriptedFlow } from "../../connection/testing/mod.ts";
import { createDocumentTool } from "./document.ts";

const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const V1 = "ver_01arz3ndektsv4rrffq69g5fav";
const V2 = "ver_01arz3ndektsv4rrffq69g5faw";
const PLACE = { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fav" };

function run(
  flow: ReturnType<typeof scriptedFlow>,
  input: Record<string, unknown>,
) {
  const resolved = resolveRoute("lophn_document", input.op as string);
  assert(resolved, `resolve ${input.op}`);
  return createDocumentTool({ client: flow.client })(
    "lophn_document",
    resolved.route,
    input,
  );
}

Deno.test("coding-agent/mcp-server#R11: unplaced는 place null로 바뀌어 가고 tool 선택자·op는 route 입력에 없다", async () => {
  const flow = scriptedFlow({
    "document.list": { documents: [], as_of_seq: "1", next_cursor: null },
  });
  await run(flow, { op: "list", unplaced: true, status: "archived", limit: 7 });
  assertEquals(flow.sent[0].input, {
    place: null,
    status: "archived",
    limit: 7,
  });
  await run(flow, { op: "list", place: PLACE });
  assertEquals(flow.sent[1].input, { place: PLACE });
});

Deno.test("coding-agent/mcp-server#R11: 목록 요약은 개수·보관 포함·생략 수·이어 읽기를 밝히고 본문 필드를 만들지 않는다", async () => {
  const flow = scriptedFlow({
    "document.list": {
      documents: [
        { document: { id: DOC, status: "archived" }, latest_version: {} },
        { document: { id: "doc_x", status: "active" }, latest_version: {} },
      ],
      as_of_seq: "1",
      next_cursor: "cur",
      omitted: [{ reason: "page_limit", count: 4 }],
    },
  });
  const result = await run(flow, { op: "list", place: PLACE, limit: 2 });
  assert(result.summary.includes("2개"), result.summary);
  assert(result.summary.includes("보관 1개 포함"), result.summary);
  assert(result.summary.includes("4개 생략"), result.summary);
  assert(result.summary.includes("본문은 목록에 없다"), result.summary);
  assert(result.next[0].includes("next_cursor"), result.next[0]);
});

Deno.test("coding-agent/mcp-server#R12: section 없는 history는 판 목록, 있으면 구역 판별 변화를 다른 route로 읽는다", async () => {
  const flow = scriptedFlow({
    "document.history": {
      document: DOC,
      versions: [{ id: V1 }, { id: V2 }],
      as_of_seq: "1",
      complete: true,
      next_cursor: null,
    },
    "document.section_history": {
      document: DOC,
      section: "계획",
      entries: [
        { status: "added" },
        { status: "modified" },
        { status: "unchanged" },
        { status: "missing" },
      ],
      omissions: [{ version: V2, section: "계획", reason: "no derived text" }],
      as_of_seq: "1",
      complete: true,
      next_cursor: null,
    },
  });
  const versions = await run(flow, { op: "history", document: DOC, from: V1 });
  assert(versions.summary.includes("고정 판 2개"), versions.summary);
  assertEquals(flow.sent[0].input, { document: DOC, from: V1 });
  const section = await run(flow, {
    op: "history",
    document: DOC,
    section: "계획",
  });
  assertEquals(flow.sent[1].name, "document.section_history");
  assertEquals(flow.sent[1].input, { document: DOC, section: "계획" });
  assert(section.summary.includes("추가 1"), section.summary);
  assert(section.summary.includes("본문 변경 1"), section.summary);
  assert(section.summary.includes("소실 1"), section.summary);
  assert(section.summary.includes("변경 없음 1"), section.summary);
  // 복원하지 못한 범위는 누락으로 밝히고 rename은 추정하지 않는다고 말한다.
  assert(section.summary.includes("비교하지 못한 곳 1개"), section.summary);
  assert(section.summary.includes("no derived text"), section.summary);
  assert(section.summary.includes("rename 추정"), section.summary);
  assertEquals(section.isError, undefined);
});

Deno.test("coding-agent/mcp-server#R12: diff는 두 고정 판의 추가·삭제를 세고 같은 판은 변경 없음, 누락은 밝힌다", async () => {
  const change = { range: { start_line: 1, end_line: 1 }, text: "줄" };
  const flow = scriptedFlow({
    "document.diff": (input: unknown) => {
      const value = input as { before: string; after: string };
      const same = value.before === value.after;
      return {
        document: DOC,
        before: { version: value.before },
        after: { version: value.after },
        section: null,
        additions: same ? [] : [change],
        deletions: same ? [] : [change, change],
        omissions: [],
        as_of_seq: "1",
        complete: true,
        next_cursor: null,
      };
    },
  });
  const diff = await run(flow, {
    op: "diff",
    document: DOC,
    before: V1,
    after: V2,
  });
  assert(diff.summary.includes("추가 1곳, 삭제 2곳"), diff.summary);
  const same = await run(flow, {
    op: "diff",
    document: DOC,
    before: V1,
    after: V1,
  });
  assert(same.summary.includes("변경 없음"), same.summary);
  const omitted = scriptedFlow({
    "document.diff": {
      document: DOC,
      additions: [],
      deletions: [],
      omissions: [{ version: V2, section: null, reason: "unverified" }],
      complete: true,
      next_cursor: null,
    },
  });
  const missing = await run(omitted, {
    op: "diff",
    document: DOC,
    before: V1,
    after: V2,
  });
  // 비교하지 못했을 뿐이라 변경 없음이 아니다.
  assertEquals(missing.summary.includes("변경 없음"), false, missing.summary);
  assert(missing.summary.includes("비교하지 못한 곳 1개"), missing.summary);
});

Deno.test("coding-agent/mcp-server#R12: 읽기 오류는 isError로 그대로 오고 저장·복원 op는 실행하지 않는다", async () => {
  const flow = scriptedFlow({
    "document.diff": () => fail("not_found", "document not found"),
  });
  const result = await run(flow, {
    op: "diff",
    document: DOC,
    before: V1,
    after: V2,
  });
  assertEquals(result.isError, true);
  assertEquals(result.summary, "document not found");
  const refused = await createDocumentTool({ client: flow.client })(
    "lophn_document",
    resolveRoute("lophn_document", "list")!.route,
    { op: "restore", document: DOC },
  );
  assertEquals(refused.isError, true);
  assertEquals(flow.sent.length, 1);
});
