// blob GC와 보존 정리 순수 규칙의 요구 테스트(platform/blob-store#R8, R9,
// R11, R13). 참조 대조·유예기간·backup 진행 표시·종류별 상한의 판정만 본다.
// 파일 관측과 실제 삭제의 동작 테스트는 apps/worker/platform/gc_test.ts다.

import { assert, assertEquals } from "@std/assert";
import {
  BLOB_UNREFERENCED_GRACE_MS,
  defineBlobField,
} from "../../../protocol/server/mod.ts";
import {
  backupPendingFolders,
  BLOB_CAPACITY_MAX_BYTES,
  capacityMax,
  capacityRuleOf,
  capacityUsage,
  deletableOf,
  gracePassed,
  referencedOf,
  retentionRules,
  staleTemporary,
  trimTargets,
  unreferencedOf,
} from "./mod.ts";

const NOW = Date.parse("2026-10-01T00:00:00.000Z");

function blob(hash: string, observedAtMs: number, sizeBytes = 1024) {
  return { hash, observedAtMs, sizeBytes, registeredAtMs: observedAtMs };
}

// R8: 고정 ledger의 모든 blob_refs와 대조한다. 참조된 blob은 미참조 목록과
// 삭제 대상에 들지 않는다. 보관·옛 판·감사 참조도 살아 있는 참조다.
Deno.test("platform/blob-store#R8: 참조된 blob은 대조에서 살아 있다", () => {
  const referenced = referencedOf([
    { hash: "b".repeat(64) },
    { hash: "c".repeat(64) },
  ]);
  assert(referenced.has("b".repeat(64)));
  assert(referenced.has("c".repeat(64)));
  assert(!referenced.has("a".repeat(64)));
});

Deno.test("platform/blob-store#R8: 참조된 blob은 미참조 목록과 삭제 대상에 없다", () => {
  const installed = [
    blob("a".repeat(64), 0),
    blob("b".repeat(64), 0),
    blob("c".repeat(64), 0),
  ];
  const referenced = referencedOf([{ hash: "b".repeat(64) }]);
  const left = unreferencedOf(installed, referenced);
  assertEquals(left.map((entry) => entry.hash), [
    "a".repeat(64),
    "c".repeat(64),
  ]);
  // 참조된 blob은 유예기간이 무엇이든 삭제 자격이 없다(R8).
  const deletable = deletableOf(installed, referenced, NOW, 0);
  assertEquals(deletable.some((entry) => entry.hash === "b".repeat(64)), false);
});

Deno.test("platform/blob-store#R8: 등록 field의 보존 규칙과 이유를 안다", () => {
  const rules = retentionRules([
    defineBlobField({
      owner_kind: "model_call",
      field: "body",
      retention: { kind: "capacity", category: "model_call_body" },
      general_read: false,
    }),
    defineBlobField({
      owner_kind: "document_version",
      field: "file",
      retention: { kind: "permanent" },
      general_read: true,
    }),
  ]);
  const capacity = capacityRuleOf(rules, "model_call", "body");
  assert(capacity.ok);
  if (capacity.ok && "category" in capacity.value) {
    assertEquals(capacity.value.category, "model_call_body");
  }
  const permanent = capacityRuleOf(rules, "document_version", "file");
  assert(permanent.ok);
  if (permanent.ok) assertEquals("kind" in permanent.value, true);
});

// R9: 미참조 확인 뒤 7일 유예기간이 통과해야 삭제 자격이 있다.
Deno.test("platform/blob-store#R9: 미참조 확인 7일 뒤에만 삭제 자격이 있다", () => {
  const grace = BLOB_UNREFERENCED_GRACE_MS;
  const fresh = blob("a".repeat(64), NOW - grace + 1000);
  const aged = blob("b".repeat(64), NOW - grace - 1000);
  assert(!gracePassed(fresh.observedAtMs, NOW, grace));
  assert(gracePassed(aged.observedAtMs, NOW, grace));
  const deletable = deletableOf([fresh, aged], new Set(), NOW, grace);
  assertEquals(deletable.map((entry) => entry.hash), ["b".repeat(64)]);
});

Deno.test("platform/blob-store#R9: 진행 중 아님을 확인한 임시 파일만 정리한다", () => {
  const grace = BLOB_UNREFERENCED_GRACE_MS;
  // 살아 있는 준비가 마지막으로 쓴 지 얼마 안 된 tmp는 정리 자격이 없다(R9).
  assert(!staleTemporary(NOW - 1000, NOW, grace));
  assert(staleTemporary(NOW - grace - 1000, NOW, grace));
});

// R11: backup.pending 표시가 남아 있으면 backup이 진행 중이다(T41). GC는
// 이 표시를 거절 근거로 쓴다.
Deno.test("platform/blob-store#R11: backup.pending 표시의 folder를 가린다", () => {
  const folders = backupPendingFolders([
    { name: "20260101T000000000Z", pending: true },
    { name: "20260102T000000000Z", pending: false },
  ]);
  assertEquals(folders, ["20260101T000000000Z"]);
});

// R13: 종류별 상한을 넘으면 오래된 것부터 정리한다. permanent는 대상에서
// 뺀다. 상한의 대상은 capacity 종류뿐이다.
Deno.test("platform/blob-store#R13: 상한을 넘은 종류만 초과를 진다", () => {
  const usage = capacityUsage(
    retentionRules([
      defineBlobField({
        owner_kind: "model_call",
        field: "body",
        retention: { kind: "capacity", category: "model_call_body" },
        general_read: false,
      }),
    ]),
    [
      blob("a".repeat(64), 0, 100),
      blob("b".repeat(64), 0, 50),
    ],
    new Map([
      ["a".repeat(64), "model_call_body" as const],
    ]),
  );
  assertEquals(usage, [{
    category: "model_call_body",
    usedBytes: 100,
    maxBytes: capacityMax("model_call_body"),
  }]);
  assertEquals(capacityMax("trace_body"), BLOB_CAPACITY_MAX_BYTES.trace_body);
});

Deno.test("platform/blob-store#R13: 오래된 것부터 상한 안으로 줄인다", () => {
  const big = 200 * 1024 * 1024;
  const max = BLOB_CAPACITY_MAX_BYTES.trace_body;
  const used = [
    blob("a".repeat(64), 100, big),
    blob("b".repeat(64), 200, big),
    blob("c".repeat(64), 300, big),
  ];
  const usage = [{
    category: "trace_body" as const,
    usedBytes: big * 3,
    maxBytes: max,
  }];
  const targets = trimTargets(
    usage,
    used.map((entry) => ({
      ...entry,
      category: "trace_body" as const,
      permanent: false,
    })),
  );
  // 초과분(big*3 - max ≈ 331MiB)까지 오래된 두 blob을 정리하고 나머지는 남는다.
  assertEquals(targets.length, 2);
  assertEquals(targets[0], "a".repeat(64));
  assertEquals(targets[1], "b".repeat(64));
});

Deno.test("platform/blob-store#R13: permanent의 blob은 정리 대상에서 뺀다", () => {
  const big = 200 * 1024 * 1024;
  const max = BLOB_CAPACITY_MAX_BYTES.trace_body;
  const usage = [{
    category: "trace_body" as const,
    usedBytes: big * 2,
    maxBytes: max,
  }];
  // permanent(변경 기록·결정·확정 결과)만 남고 capacity만 정리된다(R13).
  const targets = trimTargets(usage, [
    {
      hash: "a".repeat(64),
      observedAtMs: 0,
      sizeBytes: big,
      registeredAtMs: 50,
      category: "trace_body" as const,
      permanent: true,
    },
    {
      hash: "b".repeat(64),
      observedAtMs: 0,
      sizeBytes: big,
      registeredAtMs: 200,
      category: "trace_body" as const,
      permanent: false,
    },
  ]);
  assertEquals(targets, ["b".repeat(64)]);
});
