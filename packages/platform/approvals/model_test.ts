import { assert, assertEquals } from "@std/assert";
import type {
  ApprovalAction,
  ApprovalEffect,
} from "../../contracts/platform/mod.ts";
import {
  cancelActorAllowed,
  closeAllowed,
  creationValid,
  deadlineReached,
  descriptionPresent,
  externalDescribed,
  repairDescribed,
} from "./model.ts";

const NOW = "2026-10-05T00:00:00.000Z";
const HASH = "a".repeat(64);

const action: ApprovalAction = {
  concern: "apps/invocations",
  command: "record_started",
  caller: "app:app_01h455vb4pex5v6nkc6gd5fdw1",
  targets: ["app_01h455vb4pex5v6nkc6gd5fdw1"],
  input: {
    kind: "inline",
    value: { release: "rel_01h455vb4pex5v6nkc6gd5fdw1" },
  },
  input_hash: HASH,
  comparison: { release: "rel_01h455vb4pex5v6nkc6gd5fdw1" },
  binding_hash: "b".repeat(64),
};

const effect: ApprovalEffect = {
  changes_blob: "c".repeat(64),
  external_blob: null,
  reversible: false,
  reversibility_blob: "d".repeat(64),
};

function valid(overrides: Partial<Parameters<typeof creationValid>[0]> = {}) {
  return creationValid({
    action,
    effect,
    reason: "배포 전 확인이 필요하다",
    changes: "release 하나를 시작한다",
    reversibility: "시작한 뒤에는 되돌리지 못한다",
    external: undefined,
    repair: undefined,
    expiresAt: null,
    now: NOW,
    ...overrides,
  });
}

Deno.test("platform/approvals#R1: 이유·변경·되돌림이 공백뿐이면 생성하지 않는다", () => {
  assert(valid().ok);
  for (const blank of ["", "   ", "\n\t"]) {
    assertEquals(descriptionPresent(blank), false);
    assert(!valid({ reason: blank }).ok);
    assert(!valid({ changes: blank }).ok);
    assert(!valid({ reversibility: blank }).ok);
  }
});

Deno.test("platform/approvals#R1: 외부 전송이 있으면 수신처 설명이 있어야 한다", () => {
  const sending: ApprovalEffect = { ...effect, external_blob: "e".repeat(64) };
  assert(!externalDescribed(sending, undefined));
  assert(externalDescribed(sending, "example.com으로 결과를 보낸다"));
  assert(!externalDescribed(effect, "보낼 곳이 없다"));
  assert(!valid({ effect: sending, external: undefined }).ok);
  assert(valid({ effect: sending, external: "example.com으로 보낸다" }).ok);
});

Deno.test("platform/approvals#R2: 수리 동작은 보존 데이터와 검증 기준이 있어야 한다", () => {
  assert(!repairDescribed({ preserved: "  ", verification: "hash 비교" }));
  assert(!repairDescribed({ preserved: "원본 유지", verification: "" }));
  assert(
    repairDescribed({ preserved: "원본 유지", verification: "hash 비교" }),
  );
  assert(!valid({ repair: { preserved: "", verification: "hash 비교" } }).ok);
  assert(
    valid({
      repair: { preserved: "원본 blob 유지", verification: "sha256 비교" },
    }).ok,
  );
});

Deno.test("platform/approvals#R6: 대기 상태만 끝내고 끝난 결정은 다시 열지 않는다", () => {
  assert(closeAllowed("pending", "cancelled").ok);
  for (
    const status of ["granted", "rejected", "expired", "cancelled"] as const
  ) {
    const closed = closeAllowed(status, "expired");
    assert(!closed.ok);
    if (!closed.ok) assertEquals(closed.error.code, "conflict");
  }
});

Deno.test("platform/approvals#R12: 기본 기한은 없고 지정 기한의 경계부터 거절한다", () => {
  assertEquals(deadlineReached(null, NOW), false);
  const deadline = "2026-10-05T01:00:00.000Z";
  assertEquals(deadlineReached(deadline, "2026-10-05T00:59:59.999Z"), false);
  assertEquals(deadlineReached(deadline, deadline), true);
  assertEquals(deadlineReached(deadline, "2026-10-05T02:00:00.000Z"), true);
  assert(!valid({ expiresAt: NOW }).ok);
  assert(valid({ expiresAt: deadline }).ok);
});

Deno.test("platform/approvals#R13: 취소는 사람·원래 요청자·machine만 한다", () => {
  const requester = "agent:asg_01h455vb4pex5v6nkc6gd5fdw1" as const;
  assert(cancelActorAllowed("user", requester).ok);
  assert(cancelActorAllowed("machine", requester).ok);
  assert(cancelActorAllowed(requester, requester).ok);
  const other = cancelActorAllowed(
    "agent:asg_01h455vb4pex5v6nkc6gd5fdw2",
    requester,
  );
  assert(!other.ok);
  if (!other.ok) assertEquals(other.error.code, "forbidden");
});
