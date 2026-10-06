// approval 만료 정리(platform Q25, platform/approvals#R12 #R15)를 실제 core와 임시 LOPHN_HOME의
// HTTP route로 본다. 시각은 manual clock이고 sweep는 timer가 부르는 같은 함수를 직접 부른다.
// 시계가 기한에 닿기를 기다리는 sleep은 없다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type {
  ApprovalAction,
  ApprovalRequest,
  AuthenticatedContext,
} from "../../packages/contracts/platform/mod.ts";
import { EXPIRY_REASON_HASH } from "../../packages/platform/approvals/mod.ts";
import {
  actionOf,
  call,
  command,
  count,
  createInput,
  decide,
  inspect,
} from "./testing/approvals-fixture.ts";
import { type CoreHarness, createCoreHarness } from "./testing/core.ts";
import { startCore } from "./core.ts";

const TARGET = "doc_01h455vb4pex5v6nkc6gd5fdw1";
// credential token 모양은 base64url 43자다.
const TOKEN = "r".repeat(43);
const IDS = [1, 2, 3, 4, 5, 6].map((n) => `apr_01h455vb4pex5v6nkc6gd5fdw${n}`);
const [DUE_SOON, DUE_LATER, NO_DEADLINE, GRANTED, CANCELLED, RACED] = IDS;

const EXPIRED = "select count(*) as n from events where type = ?";

type Login = { token: string; context: AuthenticatedContext };

async function login(
  harness: CoreHarness,
  actor: "user" | "coding_agent",
  principal: string,
  operations: string[],
): Promise<Login> {
  const issued = await harness.credential({
    actor,
    principal,
    scope: { operations, targets: {} },
    conditions: {},
  });
  assert(issued.ok, issued.ok ? "" : issued.error.message);
  return issued.value;
}

function exact(note: string): Promise<ApprovalAction> {
  return actionOf({
    command: "record_owned_note",
    caller: "user",
    targets: [TARGET],
    value: { note },
    comparison: { basis: "current" },
  });
}

async function statusOf(
  harness: CoreHarness,
  token: string,
  id: string,
): Promise<ApprovalRequest> {
  const read = await call(harness, "approvals/get", token, { approval: id });
  assertEquals(read.status, 200, JSON.stringify(read.body));
  return read.body["request"] as ApprovalRequest;
}

Deno.test("platform/approvals#R12 #R15: 기한에 도달한 대기만 expired가 되고 기한 없는 대기·허락·취소된 것은 그대로이며 다시 돌려도 같다", async () => {
  const opened = await createCoreHarness({ io: true });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  try {
    const reads = ["GetApproval", "ListApprovals"];
    const requester = await login(harness, "coding_agent", "requester-1", [
      "create_approval_request",
      "cancel_approval_request",
      ...reads,
    ]);
    const user = await login(harness, "user", "user-1", [
      "grant_approval_request",
      ...reads,
    ]);
    const at = (afterMs: number) =>
      new Date(harness.clock.nowMs() + afterMs).toISOString();
    const create = async (
      id: string,
      expiresAt: string | null,
    ): Promise<ApprovalRequest> => {
      const created = await call(
        harness,
        "approvals/create",
        requester.token,
        command(
          await createInput(
            id,
            requester.context.actor,
            await exact(`note-${id}`),
            { expiresAt },
          ),
        ),
      );
      assertEquals(created.status, 200, JSON.stringify(created.body));
      return created.body["request"] as ApprovalRequest;
    };

    await create(DUE_SOON, at(60_000));
    await create(DUE_LATER, at(120_000));
    await create(NO_DEADLINE, null);
    const toGrant = await create(GRANTED, at(60_000));
    const toCancel = await create(CANCELLED, at(60_000));
    const granted = await decide(harness, user.token, toGrant, "grant");
    assertEquals(granted.status, 200, JSON.stringify(granted.body));
    const cancelled = await call(
      harness,
      "approvals/cancel",
      requester.token,
      command({
        approval: CANCELLED,
        created_seq: toCancel.created_seq,
        closed_reason_blob: EXPIRY_REASON_HASH,
      }, { compare: { created_seq: toCancel.created_seq } }),
    );
    assertEquals(cancelled.status, 200, JSON.stringify(cancelled.body));

    // 기한 직전에는 정리해도 아무것도 만료하지 않는다.
    harness.clock.advance(59_999);
    await harness.sweepApprovalExpiry();
    assertEquals(count(harness, EXPIRED, ["ApprovalRequestExpired"]), 0);
    assertEquals(
      (await statusOf(harness, user.token, DUE_SOON)).status,
      "pending",
    );

    // 기한 경계에서 그 request만 expired다. 이유는 machine이 고정한 글이고 event 주체는 machine이다.
    harness.clock.advance(1);
    await harness.sweepApprovalExpiry();
    const expired = await statusOf(harness, user.token, DUE_SOON);
    assertEquals(expired.status, "expired");
    assertEquals(expired.closed_reason_blob, EXPIRY_REASON_HASH);
    assertEquals(
      inspect(harness, "select actor from events where type = ?", [
        "ApprovalRequestExpired",
      ]).map((row) => row["actor"]),
      ["machine"],
    );
    assertEquals(
      (await statusOf(harness, user.token, DUE_LATER)).status,
      "pending",
    );
    assertEquals(
      (await statusOf(harness, user.token, NO_DEADLINE)).status,
      "pending",
    );
    // 허락된 기록은 기한이 지나도 expired로 고치지 않고, 취소된 기록도 그대로다.
    assertEquals(
      (await statusOf(harness, user.token, GRANTED)).status,
      "granted",
    );
    assertEquals(
      (await statusOf(harness, user.token, CANCELLED)).status,
      "cancelled",
    );
    assertEquals(count(harness, EXPIRED, ["ApprovalRequestExpired"]), 1);

    // 같은 시각에 다시 돌려도 새 event도 오류도 없다(idempotent).
    await harness.sweepApprovalExpiry();
    await harness.sweepApprovalExpiry();
    assertEquals(count(harness, EXPIRED, ["ApprovalRequestExpired"]), 1);

    // 늦은 기한은 그 시각이 되면 만료하고, 기한 없는 대기는 끝까지 대기다.
    harness.clock.advance(60_000);
    await harness.sweepApprovalExpiry();
    assertEquals(
      (await statusOf(harness, user.token, DUE_LATER)).status,
      "expired",
    );
    harness.clock.advance(10 * 365 * 24 * 3_600_000);
    await harness.sweepApprovalExpiry();
    assertEquals(
      (await statusOf(harness, user.token, NO_DEADLINE)).status,
      "pending",
    );
    assertEquals(count(harness, EXPIRED, ["ApprovalRequestExpired"]), 2);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R12: 만료된 request는 늦게 허락하거나 사용하지 못한다", async () => {
  const opened = await createCoreHarness({ io: true });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  try {
    const requester = await login(harness, "coding_agent", "requester-1", [
      "create_approval_request",
      "GetApproval",
    ]);
    const user = await login(harness, "user", "user-1", [
      "grant_approval_request",
      "GetApproval",
    ]);
    const created = await call(
      harness,
      "approvals/create",
      requester.token,
      command(
        await createInput(
          RACED,
          requester.context.actor,
          await exact("raced"),
          { expiresAt: new Date(harness.clock.nowMs() + 60_000).toISOString() },
        ),
      ),
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));
    const pending = created.body["request"] as ApprovalRequest;
    harness.clock.advance(60_000);
    await harness.sweepApprovalExpiry();
    assertEquals(
      (await statusOf(harness, user.token, RACED)).status,
      "expired",
    );
    // 만료 뒤의 사람 결정은 거절이고 상태는 expired로 남는다.
    const late = await decide(harness, user.token, pending, "grant");
    assert(late.status >= 400, JSON.stringify(late.body));
    assertEquals(
      (await statusOf(harness, user.token, RACED)).status,
      "expired",
    );
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R12: 재시작한 core는 기동 직후 이미 기한이 지난 대기를 만료로 확정한다", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "lophn-approval-expiry-",
  });
  const start = Date.UTC(2024, 0, 1);
  try {
    const first = await startCore({
      lophnHome: directory,
      port: 0,
      teams: [],
      clock: manualClock(start),
      random: seededRandom(1),
      testCredentials: true,
    });
    assert(first.ok, first.ok ? undefined : JSON.stringify(first.error));
    let created: ApprovalRequest;
    try {
      const requester: AuthenticatedContext = {
        actor: "machine",
        principal: "requester-machine",
        credential_ref: "test:requester-machine",
        scope: { operations: ["create_approval_request"], targets: {} },
        conditions: {},
      };
      const accepted = await first.value.acceptTestCredential!(
        requester,
        TOKEN,
      );
      assert(accepted.ok);
      const recorded = await first.value.record(requester);
      assert(recorded.ok);
      const reply = await call(
        first.value,
        "approvals/create",
        TOKEN,
        command(
          await createInput(
            RACED,
            "machine",
            await exact("before-restart"),
            { expiresAt: new Date(start + 60_000).toISOString() },
          ),
        ),
      );
      assertEquals(reply.status, 200, JSON.stringify(reply.body));
      created = reply.body["request"] as ApprovalRequest;
      assertEquals(created.status, "pending");
    } finally {
      await first.value.shutdown();
    }

    // 꺼져 있는 동안 기한이 지났다. 다시 켜면 timer를 기다리지 않고 한 번 정리한다.
    const second = await startCore({
      lophnHome: directory,
      port: 0,
      teams: [],
      clock: manualClock(start + 61_000),
      random: seededRandom(2),
      testCredentials: true,
    });
    assert(second.ok, second.ok ? undefined : JSON.stringify(second.error));
    try {
      assertEquals(
        inspect(
          second.value,
          "select status from approval_requests where id = ?",
          [
            RACED,
          ],
        ).map((row) => row["status"]),
        ["expired"],
      );
    } finally {
      await second.value.shutdown();
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
