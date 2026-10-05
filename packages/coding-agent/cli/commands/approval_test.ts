// approval command 테스트다(cli#R7, R21). open은 결정 화면 링크와 대기 사실만 내고 창을
// 열거나 허락을 받지 않으며 요청을 바꾸지 않는다. 허락·거절·사용 command가 표에 없다.
// core 대신 route별 답을 정한 흐름 client를 쓴다.
import { assert, assertEquals } from "@std/assert";
import { fail, scriptedFlow } from "../../connection/testing/mod.ts";
import { COMMANDS, findCommand } from "../registry.ts";
import { APPROVAL_COMMANDS, runApprovalOpen } from "./approval.ts";

const APPROVAL = "apr_01arz3ndektsv4rrffq69g5fav";
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
      targets: ["app_01arz3ndektsv4rrffq69g5fav"],
      input: { kind: "inline", value: {} },
      input_hash: HASH,
      comparison: {},
      binding_hash: HASH,
    },
    expires_at: null,
    status: "pending",
    closed_reason_blob: null,
    created_seq: "3",
    closed_seq: null,
    ...over,
  };
}

Deno.test("coding-agent/cli#R21: approval 표는 list·show·open뿐이고 허락·거절·사용 command가 없다", () => {
  assertEquals(APPROVAL_COMMANDS.map((entry) => entry.name), [
    "approval list",
    "approval show",
    "approval open",
  ]);
  for (
    const name of [
      "approval allow",
      "approval grant",
      "approval approve",
      "approval reject",
      "approval consume",
      "approval cancel",
    ]
  ) {
    assertEquals(findCommand(name), undefined, name);
  }
  assertEquals(
    COMMANDS.filter((entry) => entry.name.startsWith("approval ")).length,
    3,
  );
  const open = findCommand("approval open");
  assert(open);
  assert(
    open.input.safeParse({ command: "approval open", approval: APPROVAL })
      .success,
  );
  for (
    const extra of [
      { yes: true },
      { allow: true },
      { confirm: true },
      { option: "approve" },
    ]
  ) {
    assert(
      !open.input.safeParse({
        command: "approval open",
        approval: APPROVAL,
        ...extra,
      }).success,
    );
  }
});

Deno.test("coding-agent/cli#R7: approval open은 대기 사실과 결정 화면 링크만 내고 읽기 외 호출이 없다", async () => {
  const flow = scriptedFlow({
    GetApproval: {
      request: request(),
      use: null,
      as_of_seq: "9",
      next_cursor: null,
    },
  });
  const opened = await runApprovalOpen({ approval: APPROVAL }, {
    client: flow.client,
  });
  assert(opened.ok);
  assertEquals(opened.value.data, {
    approval: APPROVAL,
    state: "waiting",
    waiting: true,
    decision_link: `lophn://things-to-confirm/${APPROVAL}`,
    window_opened: false,
  });
  assert(opened.value.next[0].includes("그대로다"));
  assertEquals(flow.sent.map((call) => [call.kind, call.name]), [[
    "read",
    "GetApproval",
  ]]);
});

Deno.test("coding-agent/cli#R7: 기한이 지났거나 끝난 요청은 링크 없이 알리고 core 오류는 그대로 낸다", async () => {
  const expired = scriptedFlow({
    GetApproval: {
      request: request({
        status: "expired",
        closed_reason_blob: HASH,
        closed_seq: "4",
      }),
      use: null,
      as_of_seq: "9",
      next_cursor: null,
    },
  });
  const closed = await runApprovalOpen({ approval: APPROVAL }, {
    client: expired.client,
  });
  assert(closed.ok);
  assertEquals(closed.value.data.state, "expired");
  assertEquals(closed.value.data.decision_link, null);
  const absent = scriptedFlow({
    GetApproval: fail("not_found", "approval request가 없다"),
  });
  const missing = await runApprovalOpen({ approval: APPROVAL }, {
    client: absent.client,
  });
  assert(!missing.ok);
  assertEquals(missing.error.code, "not_found");
});
