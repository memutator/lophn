// approval 허락·거절(platform/approvals#R3, R4, R5, R6, R12, R14, R15). 실제 ledger(임시 파일
// SQLite)와 writer의 confirmation registry를 쓴다. handle은 main↔core 비공개 통로와 같은
// 발급 경로(harness.confirmation)로 만든다. 허락 적용(T23)과 거절 억제 계보(R16)는 여기 없다.

import { assert, assertEquals } from "@std/assert";
import { sha256Hex } from "../../base/mod.ts";
import {
  type ApprovalRequest,
  type AuthenticatedContext,
  grantApprovalRequest,
  rejectApprovalRequest,
} from "../../contracts/platform/mod.ts";
import { confirmationBinding } from "../identity/mod.ts";
import {
  REJECTION_WITHOUT_REASON_HASH,
  REJECTION_WITHOUT_REASON_TEXT,
} from "./commands.ts";
import {
  APP,
  APPROVAL,
  create,
  credential,
  failure,
  type LedgerHarness,
  machine,
  NOW,
  openHarness,
  requestOf,
  user,
  value,
} from "./requests_fixture_test.ts";

const OTHER = "apr_01h455vb4pex5v6nkc6gd5fdw2";

type Decision = "grant" | "reject";

async function decisionInput(
  harness: LedgerHarness,
  id: string,
  reason?: string | null,
): Promise<Record<string, unknown>> {
  const read = value(
    await harness.read({ resource: "approvals", method: "get" }, user, {
      approval: id,
    }),
  ) as { request: ApprovalRequest };
  return {
    approval: id,
    created_seq: read.request.created_seq,
    binding_hash: read.request.action.binding_hash,
    ...(reason === undefined ? {} : { closed_reason_blob: reason }),
  };
}

// 사람이 confirmation window에서 본 내용으로 handle을 발급한다.
async function issue(
  harness: LedgerHarness,
  decision: Decision,
  input: Record<string, unknown>,
): Promise<string> {
  const route = decision === "grant"
    ? grantApprovalRequest
    : rejectApprovalRequest;
  const binding = await confirmationBinding(route, input);
  assert(binding);
  const issued = value(
    await harness.confirmation({
      action: "issue",
      request: {
        type: "confirmation_handle_register",
        window_id: `win-${decision}`,
        target_ref: binding.target,
        content_hash: binding.content,
        allowed_decisions: [route.name],
        expires_at: new Date(NOW + 120_000).toISOString(),
      },
    }),
  ) as { confirmation: string };
  return issued.confirmation;
}

// 거절 입력은 이유 칸이 항상 있고(없으면 null) 허락 입력에는 이유 칸이 없다.
function shaped(
  decision: Decision,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const { closed_reason_blob: reason, ...rest } = input;
  return decision === "reject"
    ? { ...rest, closed_reason_blob: reason ?? null }
    : rest;
}

function decide(
  harness: LedgerHarness,
  ctx: AuthenticatedContext,
  decision: Decision,
  input: Record<string, unknown>,
  key: string,
  confirmation?: string,
) {
  return harness.command(ctx, {
    command: decision === "grant"
      ? "grant_approval_request"
      : "reject_approval_request",
    input: shaped(decision, input),
    idempotency_key: key,
    compare: { created_seq: input["created_seq"] },
    prepared: [],
    ...(confirmation === undefined ? {} : { confirmation }),
  });
}

async function statusOf(harness: LedgerHarness, id: string): Promise<string> {
  const rows = value(
    await harness.inspect(
      "select status from approval_requests where id = ?",
      [id],
    ),
  );
  return String(rows[0]?.["status"]);
}

Deno.test("platform/approvals#R3: handle 없이는 user 자격만으로 허락·거절하지 못한다", async () => {
  const harness = await openHarness([user]);
  try {
    value(await create(harness, user));
    const input = await decisionInput(harness, APPROVAL);
    assertEquals(
      failure(await decide(harness, user, "grant", input, "g-bare")).code,
      "forbidden",
    );
    assertEquals(
      failure(await decide(harness, user, "reject", input, "r-bare")).code,
      "forbidden",
    );
    assertEquals(await statusOf(harness, APPROVAL), "pending");
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R3: 앱·machine 자격은 handle이 있어도 자기 요청을 허락·거절하지 못한다", async () => {
  const app = credential(`app:${APP}`, "app-1");
  const harness = await openHarness([user, machine, app]);
  try {
    value(await create(harness, app));
    const input = await decisionInput(harness, APPROVAL);
    for (const decision of ["grant", "reject"] as const) {
      for (const ctx of [app, machine]) {
        const handle = await issue(harness, decision, input);
        assertEquals(
          failure(
            await decide(
              harness,
              ctx,
              decision,
              input,
              `${decision}-${ctx.principal}`,
              handle,
            ),
          ).code,
          "forbidden",
        );
      }
    }
    assertEquals(await statusOf(harness, APPROVAL), "pending");
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R3 #R4: 맞는 handle과 현재 내용이면 허락하고 끝난 결정은 다시 열리지 않는다", async () => {
  const harness = await openHarness([user]);
  try {
    value(await create(harness, user));
    const input = await decisionInput(harness, APPROVAL);
    const handle = await issue(harness, "grant", input);
    const request = requestOf(
      value(await decide(harness, user, "grant", input, "g-1", handle)),
    );
    assertEquals(request["status"], "granted");
    assertEquals(request["closed_reason_blob"], null);
    assert(request["closed_seq"] !== null);
    const events = value(
      await harness.inspect(
        "select actor, run from events where type = 'ApprovalRequestGranted'",
      ),
    );
    assertEquals(events.length, 1);
    assertEquals(events[0]["actor"], "user");
    assertEquals(events[0]["run"], null);
    // 허락은 적용이 아니다. 사용 연결은 적용 영역의 접수와 함께만 생긴다(R9).
    assertEquals(
      value(
        await harness.inspect("select count(*) as n from approval_uses"),
      )[0][
        "n"
      ],
      0n,
    );
    // 종료 뒤 새 handle로도 거절하지 못한다(R6).
    const again = await issue(harness, "reject", input);
    assertEquals(
      failure(await decide(harness, user, "reject", input, "r-late", again))
        .code,
      "conflict",
    );
    assertEquals(await statusOf(harness, APPROVAL), "granted");
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R5: 사람이 본 동작·생성 seq와 다른 결정은 거절한다", async () => {
  const harness = await openHarness([user]);
  try {
    value(await create(harness, user));
    const input = await decisionInput(harness, APPROVAL);
    // handle이 그 내용에 맞아도 request의 동작과 다르면 새 request가 필요하다.
    const changed = { ...input, binding_hash: "cd".repeat(32) };
    assertEquals(
      failure(
        await decide(
          harness,
          user,
          "grant",
          changed,
          "g-changed",
          await issue(harness, "grant", changed),
        ),
      ).code,
      "conflict",
    );
    // 다른 내용에 발급한 handle로 정확한 입력을 허락하지 못한다.
    assertEquals(
      failure(
        await decide(
          harness,
          user,
          "grant",
          input,
          "g-wrong",
          await issue(harness, "grant", changed),
        ),
      ).code,
      "forbidden",
    );
    // 낡은 생성 seq 기준은 conflict다.
    const stale = { ...input, created_seq: "999" };
    assertEquals(
      failure(
        await decide(
          harness,
          user,
          "grant",
          stale,
          "g-stale",
          await issue(harness, "grant", stale),
        ),
      ).code,
      "conflict",
    );
    assertEquals(await statusOf(harness, APPROVAL), "pending");
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R14 #R15: 거절은 이유 없이도 하고 이유가 있으면 그대로 남기며 허락이 아니다", async () => {
  const harness = await openHarness([user]);
  try {
    value(await create(harness, user));
    value(await create(harness, user, { id: OTHER }));
    const first = await decisionInput(harness, APPROVAL, null);
    const none = requestOf(
      value(
        await decide(
          harness,
          user,
          "reject",
          first,
          "r-none",
          await issue(harness, "reject", first),
        ),
      ),
    );
    assertEquals(none["status"], "rejected");
    // 저장 request는 고정한 "이유 없음" 글의 hash를 갖고, 사람이 이유를 적지 않았다는 사실은 event에 남는다.
    assertEquals(
      await sha256Hex(REJECTION_WITHOUT_REASON_TEXT),
      REJECTION_WITHOUT_REASON_HASH,
    );
    assertEquals(none["closed_reason_blob"], REJECTION_WITHOUT_REASON_HASH);
    const noReasonEvent = value(
      await harness.inspect(
        "select payload from events where type = 'ApprovalRequestRejected' order by seq limit 1",
      ),
    );
    assertEquals(
      JSON.parse(String(noReasonEvent[0]["payload"]))["closed_reason_blob"],
      null,
    );
    // 다른 대기는 그대로다.
    assertEquals(await statusOf(harness, OTHER), "pending");
    const reason = await sha256Hex("지금은 필요 없다");
    const second = await decisionInput(harness, OTHER, reason);
    const why = requestOf(
      value(
        await decide(
          harness,
          user,
          "reject",
          second,
          "r-why",
          await issue(harness, "reject", second),
        ),
      ),
    );
    assertEquals(why["status"], "rejected");
    assertEquals(why["closed_reason_blob"], reason);
    assertEquals(
      value(
        await harness.inspect("select count(*) as n from approval_uses"),
      )[0][
        "n"
      ],
      0n,
    );
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R12: 기한 경계에 도달한 대기는 handle이 있어도 결정하지 못한다", async () => {
  const harness = await openHarness([user, machine]);
  try {
    // harness 시계는 기동 시각에 고정이라 기한 경계에 이미 도달한 대기를 직접 심는다.
    value(
      await harness.command(machine, {
        command: "seed_approval_request",
        input: { id: APPROVAL, expires_at: new Date(NOW).toISOString() },
        idempotency_key: "seed-1",
        compare: {},
        prepared: [],
      }),
    );
    const input = await decisionInput(harness, APPROVAL);
    for (const decision of ["grant", "reject"] as const) {
      assertEquals(
        failure(
          await decide(
            harness,
            user,
            decision,
            input,
            `${decision}-late`,
            await issue(harness, decision, input),
          ),
        ).code,
        "conflict",
      );
    }
    assertEquals(await statusOf(harness, APPROVAL), "pending");
  } finally {
    await harness.close();
  }
});
