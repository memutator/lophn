// approval request 생성·조회·만료·취소(platform/approvals#R1, R2, R6, R12, R13, R14, R17).
// 실제 ledger(임시 파일 SQLite)를 띄운다. 설명 글은 값으로 받고 command는 같은 글에서 hash를
// 만들어 저장한다. 글의 redaction·blob 준비·읽기 round-trip은 apps/core/approval-text_test.ts가
// 실제 core로 본다.

import { assert, assertEquals } from "@std/assert";
import { sha256Hex } from "../../base/mod.ts";
import type {
  ApprovalAction,
  ApprovalEffect,
} from "../../protocol/platform/mod.ts";
import {
  action,
  APP,
  APPROVAL,
  create,
  credential,
  effect,
  failure,
  machine,
  NOW,
  openHarness,
  requestOf,
  user,
  value,
} from "./requests_fixture_test.ts";

Deno.test("platform/approvals#R1 #R17: 생성은 설명 hash를 저장하고 조회가 같은 hash를 돌려준다", async () => {
  const harness = await openHarness([user, machine]);
  try {
    const external = "example.com으로 결과를 보낸다";
    const created = value(await create(harness, user, { external }));
    const request = requestOf(created);
    assertEquals(request["status"], "pending");
    assertEquals(request["expires_at"], null);
    // 대기 request는 허락 범위도 허락 session도 없다. 카드가 session 선택을 보이는지는 생성 때 정한다.
    assertEquals(request["session_grantable"], false);
    assertEquals(request["grant_scope"], null);
    assertEquals(request["grant_session"], null);
    assertEquals(
      request["reason_blob"],
      await sha256Hex("배포 전 확인이 필요하다"),
    );
    const stored = request["effect"] as ApprovalEffect;
    assertEquals(
      stored.changes_blob,
      await sha256Hex("release 하나를 시작한다"),
    );
    assertEquals(
      stored.reversibility_blob,
      await sha256Hex("시작한 뒤에는 되돌리지 못한다"),
    );
    assertEquals(stored.external_blob, await sha256Hex(external));

    const read = value(
      await harness.read({ resource: "approvals", method: "get" }, user, {
        approval: APPROVAL,
      }),
    ) as { request: Record<string, unknown> };
    assertEquals(read.request["reason_blob"], request["reason_blob"]);
    const listed = value(
      await harness.read({ resource: "approvals", method: "list" }, user, {}),
    ) as { requests: Record<string, unknown>[] };
    assertEquals(listed.requests.length, 1);
    assertEquals(listed.requests[0]["id"], APPROVAL);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R1 #R2: 설명 글마다 영구 참조 하나가 같은 transaction에 등록되고 공백뿐인 글은 거절한다", async () => {
  const harness = await openHarness([user]);
  try {
    const external = "example.com으로 결과를 보낸다";
    value(await create(harness, user, { external }));
    const refs = value(
      await harness.inspect(
        `select field, hash from blob_refs where owner_kind = 'approval_request'
          and owner_key = ? order by field`,
        [APPROVAL],
      ),
    );
    assertEquals(
      refs.map((ref) => [ref["field"], ref["hash"]]),
      [
        ["changes", await sha256Hex("release 하나를 시작한다")],
        ["external", await sha256Hex(external)],
        ["reason", await sha256Hex("배포 전 확인이 필요하다")],
        ["reversibility", await sha256Hex("시작한 뒤에는 되돌리지 못한다")],
      ],
    );
    // 이유·변경·되돌림이 공백뿐이면 request도 참조도 만들지 않는다.
    for (const blank of ["reason", "changes", "reversibility"]) {
      const input = {
        id: "apr_01h455vb4pex5v6nkc6gd5fdw2",
        requester: user.actor,
        run: null,
        reason: blank === "reason" ? "  \n" : "이유",
        effect: {
          ...effect(undefined),
          ...(blank === "reason" ? {} : { [blank]: "   " }),
        },
        action: await action(),
        expires_at: null,
        session_grantable: false,
      };
      const rejected = await harness.command(user, {
        command: "create_approval_request",
        input,
        idempotency_key: `create-blank-${blank}`,
        compare: {},
        prepared: [],
      });
      assertEquals(failure(rejected).code, "invalid_input");
    }
    const rows = value(
      await harness.inspect("select count(*) as n from approval_requests", []),
    );
    assertEquals(Number(rows[0]["n"]), 1);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R1: 다른 actor를 대신 요청하거나 기한이 생성 시각보다 앞이면 거절한다", async () => {
  const harness = await openHarness([user]);
  try {
    const impersonated = await harness.command(user, {
      command: "create_approval_request",
      input: {
        id: APPROVAL,
        requester: "machine",
        run: null,
        reason: "배포 전 확인이 필요하다",
        effect: effect(undefined),
        action: await action(),
        expires_at: null,
        session_grantable: false,
      },
      idempotency_key: "create-impersonate",
      compare: {},
      prepared: [],
    });
    assertEquals(failure(impersonated).code, "forbidden");
    const past = await create(harness, user, {
      expiresAt: "2026-10-04T00:00:00.000Z",
      key: "create-past",
    });
    assertEquals(failure(past).code, "invalid_input");
    const rows = value(
      await harness.inspect("select count(*) as n from approval_requests", []),
    );
    assertEquals(Number(rows[0]["n"]), 0);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R6: 생성한 내용과 기한은 그대로 남고 끝난 결정은 다시 열리지 않는다", async () => {
  const harness = await openHarness([user, machine]);
  try {
    const deadline = "2026-10-06T00:00:00.000Z";
    const created = value(await create(harness, user, { expiresAt: deadline }));
    const seq = String(requestOf(created)["created_seq"]);
    const reason = "사람이 취소했다";
    const cancelled = value(
      await harness.command(user, {
        command: "cancel_approval_request",
        input: {
          approval: APPROVAL,
          created_seq: seq,
          closed_reason: reason,
        },
        idempotency_key: "cancel-1",
        compare: { created_seq: seq },
        prepared: [],
      }),
    );
    assertEquals(requestOf(cancelled)["status"], "cancelled");
    assertEquals(requestOf(cancelled)["expires_at"], deadline);
    assertEquals(
      requestOf(cancelled)["reason_blob"],
      requestOf(created)["reason_blob"],
    );
    const again = await harness.command(user, {
      command: "cancel_approval_request",
      input: {
        approval: APPROVAL,
        created_seq: seq,
        closed_reason: reason,
      },
      idempotency_key: "cancel-2",
      compare: { created_seq: seq },
      prepared: [],
    });
    assertEquals(failure(again).code, "conflict");
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R12: 기한이 없거나 아직 도달하지 않으면 만료하지 않는다", async () => {
  const harness = await openHarness([user, machine]);
  try {
    const open = value(await create(harness, user));
    const noDeadline = String(requestOf(open)["created_seq"]);
    const undated = await harness.command(machine, {
      command: "expire_approval_request",
      input: { approval: APPROVAL, created_seq: noDeadline },
      idempotency_key: "expire-undated",
      compare: { created_seq: noDeadline },
      prepared: [],
    });
    assertEquals(failure(undated).code, "conflict");

    const later = "apr_01h455vb4pex5v6nkc6gd5fdw2";
    const created = value(
      await create(harness, user, {
        id: later,
        key: "create-later",
        expiresAt: "2026-10-06T00:00:00.000Z",
      }),
    );
    const seq = String(requestOf(created)["created_seq"]);
    const early = await harness.command(machine, {
      command: "expire_approval_request",
      input: { approval: later, created_seq: seq },
      idempotency_key: "expire-early",
      compare: { created_seq: seq },
      prepared: [],
    });
    assertEquals(failure(early).code, "conflict");
    const kept = value(
      await harness.read({ resource: "approvals", method: "get" }, user, {
        approval: later,
      }),
    ) as { request: { status: string } };
    assertEquals(kept.request.status, "pending");
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R12: 기한 경계에 도달한 대기는 machine이 만료하고 그 뒤 결정을 거절한다", async () => {
  const harness = await openHarness([machine]);
  try {
    const deadline = new Date(NOW).toISOString();
    const seeded = value(
      await harness.command(machine, {
        command: "seed_approval_request",
        input: { id: APPROVAL, expires_at: deadline },
        idempotency_key: "seed-1",
        compare: {},
        prepared: [],
      }),
    );
    const seq = String(
      (seeded.result as { created_seq: string }).created_seq,
    );
    const expired = value(
      await harness.command(machine, {
        command: "expire_approval_request",
        input: { approval: APPROVAL, created_seq: seq },
        idempotency_key: "expire-1",
        compare: { created_seq: seq },
        prepared: [],
      }),
    );
    assertEquals(requestOf(expired)["status"], "expired");
    // 만료는 이유 글이 없다: 가짜 hash 없이 null이고 참조도 없다.
    assertEquals(requestOf(expired)["closed_reason_blob"], null);
    const events = value(
      await harness.inspect(
        "select payload from events where type = 'ApprovalRequestExpired'",
        [],
      ),
    );
    assertEquals(
      JSON.parse(String(events[0]["payload"]))["closed_reason_blob"],
      null,
    );
    const refs = value(
      await harness.inspect(
        "select count(*) as n from blob_refs where owner_key = ?",
        [APPROVAL],
      ),
    );
    assertEquals(Number(refs[0]["n"]), 0);
    const late = await harness.command(machine, {
      command: "expire_approval_request",
      input: { approval: APPROVAL, created_seq: seq },
      idempotency_key: "expire-late",
      compare: { created_seq: seq },
      prepared: [],
    });
    assertEquals(failure(late).code, "conflict");
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R13: 사람·원래 요청자·machine만 취소하고 다른 요청자는 거절한다", async () => {
  const requester = credential(`app:${APP}`, "app-1");
  const other = credential("app:app_01h455vb4pex5v6nkc6gd5fdw2", "app-2");
  const harness = await openHarness([requester, other, user, machine]);
  try {
    const created = value(await create(harness, requester));
    const seq = String(requestOf(created)["created_seq"]);
    const reason = "취소한다";
    const denied = await harness.command(other, {
      command: "cancel_approval_request",
      input: {
        approval: APPROVAL,
        created_seq: seq,
        closed_reason: reason,
      },
      idempotency_key: "cancel-other",
      compare: { created_seq: seq },
      prepared: [],
    });
    assertEquals(failure(denied).code, "forbidden");
    const cancelled = value(
      await harness.command(requester, {
        command: "cancel_approval_request",
        input: {
          approval: APPROVAL,
          created_seq: seq,
          closed_reason: reason,
        },
        idempotency_key: "cancel-own",
        compare: { created_seq: seq },
        prepared: [],
      }),
    );
    assertEquals(requestOf(cancelled)["status"], "cancelled");
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R14: 취소 이유는 글의 hash와 영구 참조로 남고 이유 없는 취소는 null이며 다른 대기는 유지한다", async () => {
  const harness = await openHarness([user]);
  try {
    const first = value(await create(harness, user));
    const secondId = "apr_01h455vb4pex5v6nkc6gd5fdw2";
    value(await create(harness, user, { id: secondId, key: "create-2" }));
    const reasonText = "지금은 진행하지 않는다";
    const reasonHash = await sha256Hex(reasonText);
    const seq = String(requestOf(first)["created_seq"]);
    value(
      await harness.command(user, {
        command: "cancel_approval_request",
        input: {
          approval: APPROVAL,
          created_seq: seq,
          closed_reason: reasonText,
        },
        idempotency_key: "cancel-reason",
        compare: { created_seq: seq },
        prepared: [],
      }),
    );
    const read = value(
      await harness.read({ resource: "approvals", method: "get" }, user, {
        approval: APPROVAL,
      }),
    ) as { request: { closed_reason_blob: string } };
    assertEquals(read.request.closed_reason_blob, reasonHash);
    const kept = value(
      await harness.read({ resource: "approvals", method: "get" }, user, {
        approval: secondId,
      }),
    ) as { request: { status: string } };
    assertEquals(kept.request.status, "pending");
    const refs = value(
      await harness.inspect(
        `select field, hash from blob_refs where owner_key = ?
          and field = 'closed_reason'`,
        [APPROVAL],
      ),
    );
    assertEquals(refs.map((ref) => [ref["field"], ref["hash"]]), [[
      "closed_reason",
      reasonHash,
    ]]);
    // 이유 없이 취소하면 hash도 참조도 없다.
    const second = value(
      await harness.read({ resource: "approvals", method: "get" }, user, {
        approval: secondId,
      }),
    ) as { request: { created_seq: string } };
    const bare = value(
      await harness.command(user, {
        command: "cancel_approval_request",
        input: {
          approval: secondId,
          created_seq: second.request.created_seq,
          closed_reason: null,
        },
        idempotency_key: "cancel-bare",
        compare: { created_seq: second.request.created_seq },
        prepared: [],
      }),
    );
    assertEquals(requestOf(bare)["status"], "cancelled");
    assertEquals(requestOf(bare)["closed_reason_blob"], null);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R17: 요청자는 자기 요청만 보고 다른 요청자의 요청은 보이지 않는다", async () => {
  const app = credential(`app:${APP}`, "app-1");
  const other = credential("app:app_01h455vb4pex5v6nkc6gd5fdw2", "app-2");
  const harness = await openHarness([user, app, other]);
  try {
    value(await create(harness, user, { id: APPROVAL }));
    const hidden = await harness.read(
      { resource: "approvals", method: "get" },
      other,
      { approval: APPROVAL },
    );
    assertEquals(failure(hidden).code, "not_found");
    const own = value(
      await harness.read({ resource: "approvals", method: "list" }, app, {}),
    ) as { requests: unknown[] };
    assertEquals(own.requests.length, 0);
    const seen = value(
      await harness.read({ resource: "approvals", method: "get" }, user, {
        approval: APPROVAL,
      }),
    ) as {
      request: { id: string; action: ApprovalAction; effect: ApprovalEffect };
    };
    assertEquals(seen.request.id, APPROVAL);
    assertEquals(seen.request.action.targets, [APP]);
    assert(seen.request.effect.reversibility_blob.length > 0);
  } finally {
    await harness.close();
  }
});
