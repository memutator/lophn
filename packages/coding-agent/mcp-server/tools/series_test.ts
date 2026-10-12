// lophn_series tool 테스트다(mcp#R16, cli#R20). 읽기 route만 부르고 다음 key 제안의
// 세 경우(첫 key 직접 지정·규칙 부적합·이미 사용한 key)를 이유와 함께 낸다. 생성·수정
// op가 없고 command를 부르지 않는다. core에 닿지 않는다.
import { assert, assertEquals } from "@std/assert";
import { MCP_CORE_TOOLS } from "../../../protocol/coding-agent/mod.ts";
import { resolveRoute } from "../registry.ts";
import { scriptedFlow, SERIES_ID } from "../../connection/testing/mod.ts";
import { createSeriesTool } from "./series.ts";

function run(
  flow: ReturnType<typeof scriptedFlow>,
  input: Record<string, unknown>,
) {
  const resolved = resolveRoute("lophn_series", input.op as string);
  assert(resolved);
  return createSeriesTool({ client: flow.client })(
    "lophn_series",
    resolved.route,
    input,
  );
}

const SELECTOR = { series: SERIES_ID };

function suggestion(over: Record<string, unknown>) {
  return {
    suggestion: {
      series_revision: "12",
      key: "",
      title: "",
      from: null,
      taken: false,
      document_name: null,
      ...over,
    },
  };
}

Deno.test("coding-agent/mcp-server#R16: 첫 key는 직접 지정하라고 알린다", async () => {
  const flow = scriptedFlow({ "series.next": suggestion({}) });
  const result = await run(flow, { op: "next", selector: SELECTOR });
  assertEquals((result.data as { reason: string }).reason, "first_key_manual");
  assertEquals(result.summary.includes("첫 key는 직접 정한다"), true);
  assertEquals(result.isError, undefined);
});

Deno.test("coding-agent/mcp-server#R16: 규칙에 맞지 않는 마지막 key는 제안 없음과 이유를 낸다", async () => {
  const flow = scriptedFlow({
    "series.next": suggestion({ from: "초안" }),
  });
  const result = await run(flow, { op: "next", selector: SELECTOR });
  assertEquals((result.data as { reason: string }).reason, "rule_mismatch");
  assertEquals(result.summary.includes("초안"), true);
});

Deno.test("coding-agent/mcp-server#R16: 이미 사용한 key와 사용 가능한 제안을 구별한다", async () => {
  const taken = scriptedFlow({
    "series.next": suggestion({
      key: "3",
      title: "Day 3",
      from: "2",
      taken: true,
    }),
  });
  const takenResult = await run(taken, { op: "next", selector: SELECTOR });
  assertEquals((takenResult.data as { reason: string }).reason, "taken");
  const free = scriptedFlow({
    "series.next": suggestion({ key: "3", title: "Day 3", from: "2" }),
  });
  const freeResult = await run(free, { op: "next", selector: SELECTOR });
  assertEquals((freeResult.data as { reason: string }).reason, "available");
  assertEquals(freeResult.summary, "다음 key는 3");
  // 제안만이다. 저장은 lophn_save의 몫이라고 안내한다.
  assertEquals(freeResult.next[0].includes("lophn_save"), true);
});

Deno.test("coding-agent/mcp-server#R16: list·show는 읽기 route 하나로 보내고 op를 떼어 보낸다", async () => {
  const flow = scriptedFlow({
    "series.list": { series: [{ id: SERIES_ID, member_count: 2 }] },
    "series.get": {
      series: { id: SERIES_ID, title: "Daily" },
      entries: [{ key: "1" }, { key: "2" }],
    },
  });
  const listed = await run(flow, { op: "list" });
  assertEquals(listed.summary, "series 1개");
  const shown = await run(flow, { op: "show", selector: SELECTOR });
  assertEquals(shown.summary, "Daily: 인스턴스 2개");
  assertEquals(flow.calls("series.get")[0].input, { selector: SELECTOR });
  assertEquals(flow.sent.every((call) => call.kind === "read"), true);
});

Deno.test("coding-agent/mcp-server#R16: 생성 동작이 노출되지 않고 표 밖 op는 실행하지 않는다", async () => {
  const tool = MCP_CORE_TOOLS.find((item) => item.name === "lophn_series");
  assert(tool);
  assertEquals([...tool.ops], ["list", "show", "next"]);
  for (const op of ["create", "add_instance", "set_draft", "update"]) {
    assertEquals(resolveRoute("lophn_series", op), undefined);
  }
  // 직접 호출해도 표에 없는 op는 route를 부르지 않는다.
  const flow = scriptedFlow({});
  const tool2 = createSeriesTool({ client: flow.client });
  const direct = await tool2(
    "lophn_series",
    resolveRoute("lophn_series", "list")!.route,
    { op: "create", name: "daily" },
  );
  assertEquals(direct.isError, true);
  assertEquals(flow.sent.length, 0);
});

Deno.test("coding-agent/mcp-server#R16: 소유 route의 오류(범위 밖 series)를 그대로 isError로 낸다", async () => {
  const flow = scriptedFlow({
    "series.get": {
      ok: false,
      error: { code: "not_found", message: "series not found" },
    },
  });
  const result = await run(flow, { op: "show", selector: SELECTOR });
  assertEquals(result.isError, true);
  assertEquals((result.data as { code: string }).code, "not_found");
});
