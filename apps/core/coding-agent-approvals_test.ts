// coding-agent#T16: coding agent가 MCP `lophn_approval`로 platform의 실제 approval 읽기와
// 등록 executor를 지나 approval request를 읽는다. 제품 core는 아직 approvals를 서빙하지
// 않아(platform의 approval 등록은 core 조립에 없다) HTTP가 아니라 ledger harness의 실제
// command·read handler를 FlowClient로 감싼다. coding credential의 actor 가시성은 그대로다.
// 데이터는 harness의 temp dir이고 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import {
  err,
  type LophnError,
  ok,
  type Result,
} from "../../packages/base/mod.ts";
import { fingerprint, sha256Hex } from "../../packages/base/mod.ts";
import type { FlowClient } from "../../packages/coding-agent/connection/mod.ts";
import { createApprovalTool } from "../../packages/coding-agent/mcp-server/tools/approval.ts";
import { createHandler } from "../../packages/coding-agent/mcp-server/server.ts";
import { resolveRoute } from "../../packages/coding-agent/mcp-server/registry.ts";
import {
  type ApprovalAction,
  approvalBinding,
  type AuthenticatedContext,
} from "../../packages/contracts/platform/mod.ts";
import { createLedgerHarness, type LedgerHarness } from "./testing/ledger.ts";

const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const OTHER = "cac_01arz3ndektsv4rrffq69g5faw";
const APP = "app_01arz3ndektsv4rrffq69g5fav";
const first = "apr_01arz3ndektsv4rrffq69g5fav";
const second = "apr_01arz3ndektsv4rrffq69g5faw";
const OPERATIONS = [
  "create_approval_request",
  "expire_approval_request",
  "cancel_approval_request",
  "grant_approval_request",
  "reject_approval_request",
  "GetApproval",
  "ListApprovals",
];

function credential(actor: string): AuthenticatedContext {
  return {
    actor: actor as AuthenticatedContext["actor"],
    principal: actor,
    credential_ref: `test:${actor}`,
    scope: { operations: OPERATIONS, targets: {} },
    conditions: {},
  };
}

const coding = credential(`coding_agent:${CAC}`);
const otherCoding = credential(`coding_agent:${OTHER}`);
const user = credential("user");

async function open(): Promise<LedgerHarness> {
  const opened = await createLedgerHarness({
    registrationModules: [
      new URL(
        "../../packages/platform/approvals/harness_test.ts",
        import.meta.url,
      ),
    ],
    credentials: [coding, otherCoding, user],
    nowMs: Date.UTC(2026, 9, 5),
  });
  assert(opened.ok, opened.ok ? undefined : JSON.stringify(opened.error));
  return opened.value;
}

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

async function action(requester: string): Promise<ApprovalAction> {
  const draft = {
    concern: "apps/releases",
    command: "activate_release",
    caller: requester as ApprovalAction["caller"],
    targets: [APP],
    input: { kind: "inline" as const, value: { release: "r1" } },
    input_hash: await sha256Hex("input"),
    comparison: { revision: 2 },
  };
  return {
    ...draft,
    binding_hash: await fingerprint(
      approvalBinding({ ...draft, binding_hash: "ab".repeat(32) }),
    ),
  };
}

let keys = 0;
async function create(harness: LedgerHarness, id: string, ctx = coding) {
  keys++;
  return await harness.command(ctx, {
    command: "create_approval_request",
    input: {
      id,
      requester: ctx.actor,
      run: null,
      reason: "배포 전 확인이 필요하다",
      effect: {
        changes: "release 하나를 켠다",
        external: null,
        reversible: false,
        reversibility: "켠 뒤에는 되돌리지 못한다",
      },
      action: await action(ctx.actor),
      expires_at: "2026-10-06T00:00:00.000Z",
    },
    idempotency_key: `approval-${keys}`,
    compare: {},
    prepared: [],
  });
}

// harness의 실제 read handler로 가는 읽기 전용 FlowClient다. command는 보내지 못한다.
function flowFor(harness: LedgerHarness, ctx: AuthenticatedContext) {
  const sent: string[] = [];
  const client: FlowClient = {
    command() {
      throw new Error("approval tool은 command를 보내지 않는다");
    },
    async read(route, input): Promise<Result<unknown, LophnError>> {
      sent.push(route.name);
      const read = await harness.read(
        { resource: route.resource, method: route.method },
        ctx,
        input,
      );
      return read.ok ? ok(read.value) : err(read.error);
    },
  };
  const tool = createApprovalTool({ client });
  const handler = createHandler({
    toolsets: ["core"],
    callTool: (name, args) => {
      const resolved = resolveRoute(name, (args as { op?: string }).op);
      assert(resolved);
      return tool(name, resolved.route, args);
    },
  });
  return {
    sent,
    async call(args: unknown) {
      const reply = await handler(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "lophn_approval", arguments: args },
      }));
      return (reply as {
        result: {
          isError?: boolean;
          structuredContent: {
            summary: string;
            data: Record<string, unknown>;
            next: string[];
          };
        };
      }).result;
    },
  };
}

type Shown = { request: Record<string, unknown> };

Deno.test("coding-agent/mcp-server#R18: 실제 approval 대기를 exact 대상·입력·영향·기한과 결정 화면 링크로 읽는다", async () => {
  const harness = await open();
  try {
    value(await create(harness, first));
    const { call, sent } = flowFor(harness, coding);
    const shown = await call({ op: "show", approval: first });
    assertEquals(shown.isError, undefined, JSON.stringify(shown));
    const request = (shown.structuredContent.data as Shown).request;
    assertEquals(request.state, "waiting");
    assertEquals(request.decision_link, `lophn://things-to-confirm/${first}`);
    const action = request.action as {
      targets: string[];
      input: { value: { release: string } };
      command: string;
    };
    assertEquals(action.command, "activate_release");
    assertEquals(action.targets, [APP]);
    assertEquals(action.input.value.release, "r1");
    assertEquals(request.expires_at, "2026-10-06T00:00:00.000Z");
    assertEquals(
      (request.effect as { reversible: boolean }).reversible,
      false,
    );
    assertEquals(request.use === undefined, true);
    assertEquals(sent, ["GetApproval"]);
    // 승인 대기는 요청 실패가 아니다.
    assert(shown.structuredContent.summary.includes("기다린다"));
    const listed = await call({ op: "list", status: "pending" });
    assertEquals(listed.structuredContent.summary, "approval 1개, 대기 1개");
  } finally {
    await harness.close();
  }
});

Deno.test("coding-agent/mcp-server#R18: 사람이 취소한 요청은 대기가 아니라 취소로 읽히고 대기 목록에서 빠진다", async () => {
  const harness = await open();
  try {
    value(await create(harness, first));
    value(await create(harness, second));
    const { call } = flowFor(harness, coding);
    const shown = await call({ op: "show", approval: second });
    const createdSeq = String(
      (shown.structuredContent.data as { request: { created_seq: string } })
        .request.created_seq,
    );
    value(
      await harness.command(user, {
        command: "cancel_approval_request",
        input: {
          approval: second,
          created_seq: createdSeq,
          closed_reason: "필요 없어졌다",
        },
        idempotency_key: "cancel-second",
        compare: { created_seq: createdSeq },
        prepared: [],
      }),
    );
    const cancelled = await call({ op: "show", approval: second });
    const request = (cancelled.structuredContent.data as Shown).request;
    assertEquals(request.state, "cancelled");
    assertEquals(request.decision_link, null);
    const waiting = await call({ op: "list", status: "pending" });
    assertEquals(waiting.structuredContent.summary, "approval 1개, 대기 1개");
    const all = await call({ op: "list" });
    assertEquals(all.structuredContent.summary, "approval 2개, 대기 1개");
  } finally {
    await harness.close();
  }
});

Deno.test("coding-agent/connection#R7: 승인 대기 응답 뒤 같은 연결의 허락·거절·만료·남의 요청 취소는 거절되고 대기가 그대로다", async () => {
  const harness = await open();
  try {
    value(await create(harness, first));
    const { call } = flowFor(harness, coding);
    const shown = await call({ op: "show", approval: first });
    const request = (shown.structuredContent.data as {
      request: { created_seq: string; action: { binding_hash: string } };
    }).request;
    const seq = String(request.created_seq);
    // tool 표에는 결정 op가 없다.
    for (const op of ["allow", "grant", "reject", "consume"]) {
      const refused = await call({ op, approval: first });
      assertEquals(refused.isError, true, op);
    }
    // 같은 credential의 직접 요청도 닫혀 있다.
    const attempts = [
      {
        command: "grant_approval_request",
        input: {
          approval: first,
          created_seq: seq,
          binding_hash: request.action.binding_hash,
        },
      },
      {
        command: "reject_approval_request",
        input: {
          approval: first,
          created_seq: seq,
          binding_hash: request.action.binding_hash,
          closed_reason: null,
        },
      },
      {
        command: "expire_approval_request",
        input: { approval: first, created_seq: seq },
      },
    ];
    for (const attempt of attempts) {
      const refused = await harness.command(coding, {
        ...attempt,
        idempotency_key: `refuse-${attempt.command}`,
        compare: { created_seq: seq },
        prepared: [],
      });
      assert(!refused.ok, attempt.command);
    }
    // 다른 connection은 이 요청을 취소하지도 못한다.
    const cancelled = await harness.command(otherCoding, {
      command: "cancel_approval_request",
      input: {
        approval: first,
        created_seq: seq,
        closed_reason: "남의 요청",
      },
      idempotency_key: "refuse-cancel",
      compare: { created_seq: seq },
      prepared: [],
    });
    assert(!cancelled.ok);
    const after = await call({ op: "show", approval: first });
    assertEquals(
      (after.structuredContent.data as Shown).request.state,
      "waiting",
    );
  } finally {
    await harness.close();
  }
});

Deno.test("coding-agent/mcp-server#R18: 다른 connection의 approval은 없는 요청과 같은 응답이다", async () => {
  const harness = await open();
  try {
    value(await create(harness, first));
    const other = flowFor(harness, otherCoding);
    const foreign = await other.call({ op: "show", approval: first });
    const absent = await other.call({
      op: "show",
      approval: "apr_01arz3ndektsv4rrffq69g5fax",
    });
    assertEquals(foreign.isError, true);
    assertEquals(foreign.structuredContent, absent.structuredContent);
    const listed = await other.call({ op: "list" });
    assertEquals(listed.structuredContent.summary, "approval 0개, 대기 0개");
  } finally {
    await harness.close();
  }
});
