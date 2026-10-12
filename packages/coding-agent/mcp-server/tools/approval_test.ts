// lophn_approval tool 테스트다(mcp#R18). 읽기 route만 부르고 대기·허락·사용·거절·만료를
// 구별하며 exact 대상·입력·영향·기한을 그대로 읽는다. 허락·거절·사용 op가 없고 command를
// 부르지 않는다. 실패는 server 응답의 isError까지 닿는다. core에 닿지 않는다.
import { assert, assertEquals } from "@std/assert";
import { MCP_DECISION_TOOLS } from "../../../protocol/coding-agent/mod.ts";
import { fail, scriptedFlow } from "../../connection/testing/mod.ts";
import { createHandler } from "../server.ts";
import { resolveRoute } from "../registry.ts";
import { createApprovalTool } from "./approval.ts";

const APPROVAL = "apr_01arz3ndektsv4rrffq69g5fav";
const OTHER = "apr_01arz3ndektsv4rrffq69g5faw";
const TARGET = "app_01arz3ndektsv4rrffq69g5fav";
const HASH = "a".repeat(64);

function request(over: Record<string, unknown> = {}) {
  return {
    id: APPROVAL,
    requester: "coding_agent:cac_01arz3ndektsv4rrffq69g5fav",
    run: null,
    reason_blob: HASH,
    effect: {
      changes_blob: HASH,
      external_blob: null,
      reversible: false,
      reversibility_blob: HASH,
    },
    action: {
      concern: "apps/releases",
      command: "activate_release",
      caller: "coding_agent:cac_01arz3ndektsv4rrffq69g5fav",
      targets: [TARGET],
      input: { kind: "inline", value: { release: "r1" } },
      input_hash: HASH,
      comparison: { revision: 2 },
      binding_hash: HASH,
    },
    expires_at: "2026-10-07T00:00:00.000Z",
    status: "pending",
    closed_reason_blob: null,
    created_seq: "3",
    closed_seq: null,
    ...over,
  };
}

const USE = {
  approval: APPROVAL,
  concern: "apps/releases",
  receipt: { kind: "event", seq: "9" },
  accepted_seq: "9",
};

function run(
  flow: ReturnType<typeof scriptedFlow>,
  input: Record<string, unknown>,
) {
  const resolved = resolveRoute("lophn_approval", input.op as string);
  assert(resolved);
  return createApprovalTool({ client: flow.client })(
    "lophn_approval",
    resolved.route,
    input,
  );
}

Deno.test("coding-agent/mcp-server#R18: show는 exact 대상·입력·영향·기한을 그대로 읽고 대기 중이면 결정 화면 링크를 낸다", async () => {
  const flow = scriptedFlow({
    GetApproval: {
      request: request(),
      use: null,
      as_of_seq: "9",
      next_cursor: null,
    },
  });
  const result = await run(flow, { op: "show", approval: APPROVAL });
  const shown = (result.data as { request: Record<string, unknown> }).request;
  assertEquals(shown.state, "waiting");
  assertEquals(shown.decision_link, `lophn://things-to-confirm/${APPROVAL}`);
  const action = shown.action as { targets: string[]; input: unknown };
  assertEquals(action.targets, [TARGET]);
  assertEquals(action.input, { kind: "inline", value: { release: "r1" } });
  assertEquals(shown.expires_at, "2026-10-07T00:00:00.000Z");
  assertEquals(
    (shown.effect as { reversible: boolean }).reversible,
    false,
  );
  assertEquals(result.isError, undefined);
  assertEquals(flow.sent.map((call) => [call.kind, call.name]), [[
    "read",
    "GetApproval",
  ]]);
  assertEquals(flow.sent[0].input, { approval: APPROVAL });
  // 승인 대기는 요청 실패가 아니다.
  assert(result.summary.includes("기다린다"));
});

Deno.test("coding-agent/mcp-server#R18: 대기·허락·사용·거절·만료·취소를 서로 다른 상태로 낸다", async () => {
  const closed = { closed_reason_blob: HASH, closed_seq: "4" };
  const cases: [Record<string, unknown>, unknown, string][] = [
    [{}, null, "waiting"],
    [{ status: "granted", closed_seq: "4" }, null, "granted"],
    [{ status: "granted", closed_seq: "4" }, USE, "used"],
    [{ status: "rejected", ...closed }, null, "rejected"],
    [{ status: "expired", ...closed }, null, "expired"],
    [{ status: "cancelled", ...closed }, null, "cancelled"],
  ];
  const states = new Set<string>();
  for (const [over, use, state] of cases) {
    const flow = scriptedFlow({
      GetApproval: {
        request: request(over),
        use,
        as_of_seq: "9",
        next_cursor: null,
      },
    });
    const result = await run(flow, { op: "show", approval: APPROVAL });
    const shown = (result.data as { request: Record<string, unknown> })
      .request;
    assertEquals(shown.state, state);
    assertEquals(shown.decision_link !== null, state === "waiting");
    states.add(String(shown.state));
  }
  assertEquals(states.size, cases.length);
});

Deno.test("coding-agent/mcp-server#R18: list는 대기 수를 알리고 filter를 소유 입력 그대로 보내며 사용 여부는 show로 안내한다", async () => {
  const flow = scriptedFlow({
    ListApprovals: {
      requests: [
        request(),
        request({ id: OTHER, status: "granted", closed_seq: "4" }),
      ],
      as_of_seq: "9",
      next_cursor: null,
    },
  });
  const result = await run(flow, { op: "list", status: "pending", limit: 5 });
  assertEquals(result.summary, "approval 2개, 대기 1개");
  const rows = (result.data as { requests: { state: string }[] }).requests;
  assertEquals(rows.map((row) => row.state), ["waiting", "granted"]);
  assertEquals(flow.sent[0].input, { status: "pending", limit: 5 });
  assert(result.next[0].includes("show"));
});

Deno.test("coding-agent/mcp-server#R18: 허락·거절·사용 op는 discovery와 직접 호출 모두에서 실행되지 않는다", async () => {
  const tool = MCP_DECISION_TOOLS.find((item) =>
    item.name === "lophn_approval"
  );
  assert(tool);
  assertEquals([...tool.ops], ["list", "show"]);
  const flow = scriptedFlow({});
  const direct = createApprovalTool({ client: flow.client });
  for (
    const op of [
      "allow",
      "reject",
      "consume",
      "grant",
      "expire",
      "cancel",
      "apply",
      "create",
    ]
  ) {
    assertEquals(resolveRoute("lophn_approval", op), undefined, op);
    const result = await direct(
      "lophn_approval",
      resolveRoute("lophn_approval", "list")!.route,
      { op, approval: APPROVAL },
    );
    assertEquals(result.isError, true, op);
  }
  assertEquals(flow.sent.length, 0);
});

Deno.test("coding-agent/mcp-server#R18: 남의 요청의 core 오류는 isError로 server 응답에 닿고 입력 오류는 core에 가기 전에 거절된다", async () => {
  const flow = scriptedFlow({
    GetApproval: fail("not_found", "approval request가 없다"),
  });
  const tool = createApprovalTool({ client: flow.client });
  const handler = createHandler({
    toolsets: ["core"],
    callTool: (name, args) => {
      const resolved = resolveRoute(name, (args as { op?: string }).op);
      assert(resolved);
      return tool(name, resolved.route, args);
    },
  });
  const call = async (args: unknown) => {
    const reply = await handler(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "lophn_approval", arguments: args },
    }));
    return (reply as {
      result: {
        isError?: boolean;
        structuredContent: { data: { code?: string } };
      };
    }).result;
  };
  const absent = await call({ op: "show", approval: APPROVAL });
  assertEquals(absent.isError, true);
  assertEquals(absent.structuredContent.data.code, "not_found");
  assertEquals(flow.sent.length, 1);
  const bad = await call({ op: "show", approval: "apr_bad" });
  assertEquals(bad.isError, true);
  const grant = await call({ op: "grant", approval: APPROVAL });
  assertEquals(grant.isError, true);
  assertEquals(flow.sent.length, 1);
});
