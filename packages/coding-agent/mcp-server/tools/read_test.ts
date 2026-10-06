// lophn_read tool 테스트다(mcp#R10). 고정 판의 본문을 소유 읽기 route 하나로 읽고, 새 판
// 존재·이어 읽기·구역 없음·추출 실패·지원하지 않는 형식을 서로 다른 결과로 낸다.
// 문서 부재(not_found)만 오류다. core에 닿지 않는다.
import { assert, assertEquals } from "@std/assert";
import { resolveRoute } from "../registry.ts";
import { fail, scriptedFlow } from "../../connection/testing/mod.ts";
import { createReadTool } from "./read.ts";

const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const V1 = "ver_01arz3ndektsv4rrffq69g5fav";
const V2 = "ver_01arz3ndektsv4rrffq69g5faw";

function run(
  flow: ReturnType<typeof scriptedFlow>,
  input: Record<string, unknown>,
) {
  const resolved = resolveRoute("lophn_read", undefined);
  assert(resolved);
  return createReadTool({ client: flow.client })(
    "lophn_read",
    resolved.route,
    input,
  );
}

const REFERENCE = { document: DOC, version: V1, section: null };

function body(over: Record<string, unknown>) {
  return {
    document: DOC,
    version: V1,
    latest_version: V1,
    section: null,
    section_status: "whole",
    include_children: false,
    ranges: [],
    text: "본문",
    redacted: false,
    failure_reason: null,
    omission_reason: null,
    file: null,
    complete: true,
    next_cursor: null,
    as_of_seq: "5",
    ...over,
  };
}

Deno.test("coding-agent/mcp-server#R10: 입력을 그대로 읽기 route 하나로 보내고 끝까지 읽은 결과를 낸다", async () => {
  const flow = scriptedFlow({ "document.read": body({}) });
  const result = await run(flow, {
    reference: REFERENCE,
    section: null,
    ranges: [],
  });
  assertEquals(flow.sent.length, 1);
  assertEquals(flow.sent[0].kind, "read");
  assertEquals(
    (flow.sent[0].input as { reference: unknown }).reference,
    REFERENCE,
  );
  assert(result.summary.includes("끝까지 읽었다"), result.summary);
  assertEquals(result.isError, undefined);
  assertEquals(result.next, []);
});

Deno.test("coding-agent/mcp-server#R10: 이어 읽을 범위와 새 판 존재를 알리고 고정 판을 유지하라고 안내한다", async () => {
  const flow = scriptedFlow({
    "document.read": body({
      latest_version: V2,
      complete: false,
      next_cursor: "cur",
    }),
  });
  const result = await run(flow, { reference: REFERENCE });
  assert(result.summary.includes("이어 읽을 범위가 남았다"), result.summary);
  assert(result.summary.includes(V2), result.summary);
  assert(result.next[0].includes("새 판이 생겨도"), result.next[0]);
  assert(result.next[1].includes("latest_version"), result.next[1]);
  assertEquals(result.isError, undefined);
});

Deno.test("coding-agent/mcp-server#R10: 구역 없음·추출 실패·지원하지 않는 형식은 부재가 아닌 결과로 구별한다", async () => {
  const file = { version: V1, path: "a.pdf" };
  const cases: [Record<string, unknown>, string][] = [
    [
      { section: "없음", section_status: "missing", text: null },
      "이 판에 없다",
    ],
    [
      {
        section_status: "unverified",
        failure_reason: "extraction timed out",
        text: null,
        file,
      },
      "extraction timed out",
    ],
    [
      { section_status: "unsupported", text: null, file },
      "지원하지 않는다",
    ],
  ];
  for (const [over, expected] of cases) {
    const flow = scriptedFlow({ "document.read": body(over) });
    const result = await run(flow, { reference: REFERENCE });
    assert(result.summary.includes(expected), `${expected}: ${result.summary}`);
    assertEquals(result.isError, undefined, expected);
  }
  const flow = scriptedFlow({
    "document.read": body({
      section_status: "unverified",
      failure_reason: "x",
      text: null,
      file,
    }),
  });
  const unverified = await run(flow, { reference: REFERENCE });
  assert(unverified.summary.includes("없는 문서가 아니다"));
  assertEquals((unverified.data as { file: unknown }).file, file);
});

Deno.test("coding-agent/mcp-server#R10: 가려진 본문은 빈 본문과 구별하고 일부 가림을 알린다", async () => {
  const hidden = scriptedFlow({
    "document.read": body({
      text: null,
      redacted: true,
      omission_reason: "secret",
    }),
  });
  const withheld = await run(hidden, { reference: REFERENCE });
  assert(withheld.summary.includes("본문을 내지 않았다(secret)"));
  const partly = scriptedFlow({ "document.read": body({ redacted: true }) });
  const some = await run(partly, { reference: REFERENCE });
  assert(some.summary.includes("일부는 가려졌다"), some.summary);
});

Deno.test("coding-agent/mcp-server#R10: core 오류는 isError로 이유와 진단 code가 그대로 오고 다음 조회를 안내한다", async () => {
  const flow = scriptedFlow({
    "document.read": () => fail("not_found", "document not found"),
  });
  const result = await run(flow, { reference: REFERENCE });
  assertEquals(result.isError, true);
  assertEquals(result.summary, "document not found");
  assertEquals((result.data as { code: string }).code, "not_found");
  assert(result.next[0].includes("lophn_index document"));
  const conflict = scriptedFlow({
    "document.read": () => fail("invalid_input", "cursor does not match"),
  });
  const mismatch = await run(conflict, { reference: REFERENCE, cursor: "x" });
  assertEquals(mismatch.isError, true);
});
