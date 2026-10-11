// lophn_question tool 테스트다(mcp#R18). 읽기 route만 부르고 대기·답 접수·적용·닫힘을
// 구별하며 대기 중인 질문에만 결정 화면 링크를 붙인다. 답·허락·취소 op가 없고 command를
// 부르지 않는다. 실패는 server 응답의 isError까지 닿는다. core에 닿지 않는다.
import { assert, assertEquals } from "@std/assert";
import { MCP_DECISION_TOOLS } from "../../../contracts/coding-agent/mod.ts";
import { fail, scriptedFlow } from "../../connection/testing/mod.ts";
import { createHandler } from "../server.ts";
import { resolveRoute } from "../registry.ts";
import { createQuestionTool } from "./question.ts";

const GROUP = "qgr_01arz3ndektsv4rrffq69g5fav";
const OTHER = "qgr_01arz3ndektsv4rrffq69g5faw";
const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";
const HASH = "a".repeat(64);

function record(
  over: Record<string, unknown> = {},
  applied = false,
) {
  return {
    id: GROUP,
    run: "run_01arz3ndektsv4rrffq69g5fav",
    session: null,
    expires_at: null,
    status: "pending",
    closed_reason: null,
    closed_reason_blob: null,
    created_seq: "3",
    closed_seq: null,
    questions: [{
      id: QUESTION,
      group: GROUP,
      position: 1,
      prompt_blob: HASH,
      reason_blob: HASH,
      options: [{
        key: "a",
        label: "Option a",
        description_blob: HASH,
        evidence: [],
        adoption: null,
        action: null,
      }],
      recommendation: null,
      answer: over.status === "answered" ? { kind: "option" } : null,
      applied,
    }],
    ...over,
  };
}

function run(
  flow: ReturnType<typeof scriptedFlow>,
  input: Record<string, unknown>,
) {
  const resolved = resolveRoute("lophn_question", input.op as string);
  assert(resolved);
  return createQuestionTool({ client: flow.client })(
    "lophn_question",
    resolved.route,
    input,
  );
}

Deno.test("coding-agent/mcp-server#R18: show는 이유·option·고정 action을 그대로 읽고 대기 중이면 결정 화면 링크를 낸다", async () => {
  const flow = scriptedFlow({
    ReadQuestionGroup: { group: record(), as_of_seq: "9", next_cursor: null },
  });
  const result = await run(flow, { op: "show", group: GROUP });
  const group = (result.data as { group: Record<string, unknown> }).group;
  assertEquals(group.state, "waiting");
  assertEquals(group.waiting, true);
  assertEquals(group.decision_link, `lophn://things-to-confirm/${GROUP}`);
  const question = (group.questions as Record<string, unknown>[])[0];
  assertEquals(question.reason_blob, HASH);
  assertEquals((question.options as unknown[]).length, 1);
  assertEquals(result.isError, undefined);
  // 읽기 route 하나로 op를 떼고 보낸다. command는 없다.
  assertEquals(flow.sent.map((call) => [call.kind, call.name]), [[
    "read",
    "ReadQuestionGroup",
  ]]);
  assertEquals(flow.sent[0].input, { group: GROUP });
  // 사람이 답한다는 안내만 있고 coding agent의 동작은 없다.
  assertEquals(result.next.length, 1);
  assert(result.next[0].includes("lophn://things-to-confirm/"));
});

Deno.test("coding-agent/mcp-server#R18: 대기·답 접수·적용·미룸·취소·만료를 서로 다른 상태로 낸다", async () => {
  const cases: [Record<string, unknown>, string, boolean, boolean?][] = [
    [{}, "waiting", true],
    [{ status: "answered", closed_seq: "4" }, "answered", false],
    [{ status: "answered", closed_seq: "4" }, "applied", false, true],
    [
      {
        status: "cancelled",
        closed_reason: "deferred",
        closed_seq: "4",
      },
      "deferred",
      false,
    ],
    [
      {
        status: "cancelled",
        closed_reason: "superseded",
        closed_reason_blob: HASH,
        closed_seq: "4",
      },
      "superseded",
      false,
    ],
    [
      {
        status: "cancelled",
        closed_reason: "cancelled",
        closed_reason_blob: HASH,
        closed_seq: "4",
      },
      "cancelled",
      false,
    ],
    [
      { status: "expired", closed_reason: "expired", closed_seq: "4" },
      "expired",
      false,
    ],
  ];
  const states: string[] = [];
  for (const [over, state, hasLink, applied] of cases) {
    const flow = scriptedFlow({
      ReadQuestionGroup: {
        group: record(over, applied === true),
        as_of_seq: "9",
        next_cursor: null,
      },
    });
    const result = await run(flow, { op: "show", group: GROUP });
    const shown = (result.data as { group: Record<string, unknown> }).group;
    states.push(String(shown.state));
    assertEquals(shown.state, state);
    // 링크는 대기 중인 질문에만 있다. 닫힌 질문에는 결정할 화면이 없다.
    assertEquals(shown.decision_link !== null, hasLink, state);
  }
  assertEquals(new Set(states).size, cases.length);
});

Deno.test("coding-agent/mcp-server#R18: list는 대기 수와 이어 읽기 cursor를 알리고 filter를 소유 입력 그대로 보낸다", async () => {
  const flow = scriptedFlow({
    ListQuestionGroups: {
      groups: [
        record(),
        record({ id: OTHER, status: "answered", closed_seq: "5" }),
      ],
      as_of_seq: "9",
      next_cursor: "c1",
    },
  });
  const result = await run(flow, {
    op: "list",
    status: "pending",
    cursor: "c0",
  });
  assertEquals(result.summary, "질문 묶음 2개, 대기 1개");
  const rows = (result.data as { groups: { state: string }[] }).groups;
  assertEquals(rows.map((row) => row.state), ["waiting", "answered"]);
  assertEquals(flow.sent[0].input, { status: "pending", cursor: "c0" });
  assert(result.next.some((line) => line.includes("next_cursor")));
});

Deno.test("coding-agent/mcp-server#R18: 답·허락·거절·취소·적용 op는 discovery와 직접 호출 모두에서 실행되지 않는다", async () => {
  const tool = MCP_DECISION_TOOLS.find((item) =>
    item.name === "lophn_question"
  );
  assert(tool);
  assertEquals([...tool.ops], ["list", "show"]);
  const ops = [
    "answer",
    "allow",
    "reject",
    "consume",
    "defer",
    "cancel",
    "expire",
    "apply-option",
    "create",
  ];
  const flow = scriptedFlow({});
  const direct = createQuestionTool({ client: flow.client });
  for (const op of ops) {
    assertEquals(resolveRoute("lophn_question", op), undefined, op);
    // 표 밖 op는 직접 부르더라도 route를 보내지 않는다.
    const result = await direct(
      "lophn_question",
      resolveRoute("lophn_question", "list")!.route,
      { op, group: GROUP },
    );
    assertEquals(result.isError, true, op);
  }
  assertEquals(flow.sent.length, 0);
});

Deno.test("coding-agent/mcp-server#R18: 범위 밖 질문의 core 오류는 isError로 server 응답에 닿고 입력 오류는 core에 가기 전에 거절된다", async () => {
  const flow = scriptedFlow({
    ReadQuestionGroup: fail("not_found", "question group not found"),
  });
  const tool = createQuestionTool({ client: flow.client });
  const handler = createHandler({
    toolsets: ["core"],
    callTool: (name, args) => {
      const resolved = resolveRoute(
        name,
        (args as { op?: string }).op,
      );
      assert(resolved);
      return tool(name, resolved.route, args);
    },
  });
  const call = async (args: unknown) => {
    const reply = await handler(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "lophn_question", arguments: args },
    }));
    return (reply as {
      result: {
        isError?: boolean;
        structuredContent: { summary: string; data: { code?: string } };
      };
    }).result;
  };
  const absent = await call({ op: "show", group: GROUP });
  assertEquals(absent.isError, true);
  assertEquals(absent.structuredContent.data.code, "not_found");
  assertEquals(flow.sent.length, 1);
  // 형식이 틀린 id는 실행 전에 거절이고 core 호출이 없다.
  const bad = await call({ op: "show", group: "qgr_bad" });
  assertEquals(bad.isError, true);
  assertEquals(flow.sent.length, 1);
  // 답 op는 표 밖이라 실행 전 거절이다.
  const answer = await call({ op: "answer", group: GROUP });
  assertEquals(answer.isError, true);
  assertEquals(flow.sent.length, 1);
});
