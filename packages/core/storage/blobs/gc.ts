// blob GC와 보존 정리의 순수 규칙(platform/blob-store#R8, R9, R10, R11, R13).
// IO 없음. 참조 대조·유예기간·종류별 상한 판정만 하고, 파일 관측과 삭제는
// I/O worker의 몫이다(core는 다시 하지 않는다).

import { err, ok, type Result } from "../../../base/mod.ts";
import {
  BLOB_RETENTION_CATEGORIES,
  type BlobFieldDefinition,
  type BlobRetentionCategory,
} from "../../../protocol/server/mod.ts";

// 정리한 blob을 읽으면 이 이유다(R13: "정리됨"). contracts의 안전 이유 하나다.
export type PrunedReason = "pruned";

// 설치 blob 하나의 관측값. hash는 경로이고, 마지막 관측은 설치 파일의 시각이다.
export type InstalledBlob = {
  hash: string;
  // 파일 mtime. 참조 없음을 확인한 때부터 유예기간을 센다(R9).
  observedAtMs: number;
  sizeBytes: number;
};

// 종류별 용량 상한(R13: 측정해 고정한 값). 큰 자료는 무제한으로 약속할 수 없다.
// 변경 기록·결정·확정 결과(retention permanent)는 상한의 대상이 아니다.
export const BLOB_CAPACITY_MAX_BYTES: Readonly<
  Record<BlobRetentionCategory, number>
> = {
  model_call_body: 512 * 1024 * 1024,
  snapshot_attachment: 512 * 1024 * 1024,
  trace_body: 256 * 1024 * 1024,
  operational_log: 256 * 1024 * 1024,
};

// 등록 field에서 보존 규칙 목록을 산다. permanent는 GC·용량 정리의 대상이
// 아니다(R13). capacity만 종류별 상한 판정을 받는다.
export type RetentionRule = {
  owner_kind: string;
  field: string;
  retention:
    | { kind: "permanent" }
    | { kind: "capacity"; category: BlobRetentionCategory };
};

export function retentionRules(
  fields: readonly BlobFieldDefinition[],
): readonly RetentionRule[] {
  const rules: RetentionRule[] = [];
  for (const field of fields) {
    rules.push({
      owner_kind: field.owner_kind,
      field: field.field,
      retention: field.retention,
    });
  }
  return rules;
}

// 참조된 hash 집합. 대조는 이 집합 하나로 한다(R8: 고정 ledger의 모든 참조).
export function referencedOf(
  refs: readonly { hash: string }[],
): ReadonlySet<string> {
  return new Set(refs.map((ref) => ref.hash));
}

// 고정 참조와 대조해 미참조 설치 blob을 산다(R8). 참조된 blob은 목록에
// 넣지 않는다: 경합의 어느 순간에도 근거를 지우지 않는다(R4, R8).
export function unreferencedOf(
  installed: readonly InstalledBlob[],
  referenced: ReadonlySet<string>,
): readonly InstalledBlob[] {
  return installed.filter((blob) => !referenced.has(blob.hash));
}

// 미참조 확인 시각부터 7일 유예기간이 지났는지(R9). 지나지 않으면 삭제
// 자격이 없다. 설치 직후 commit 전 종료의 고아가 즉시 사라지지 않는다.
export function gracePassed(
  observedAtMs: number,
  nowMs: number,
  graceMs: number,
): boolean {
  return nowMs - observedAtMs >= graceMs;
}

// 실제 삭제 자격이 있는 blob. 미참조 + 유예기간 통과(R8, R9).
export function deletableOf(
  installed: readonly InstalledBlob[],
  referenced: ReadonlySet<string>,
  nowMs: number,
  graceMs: number,
): readonly InstalledBlob[] {
  return unreferencedOf(installed, referenced).filter((blob) =>
    gracePassed(blob.observedAtMs, nowMs, graceMs)
  );
}

// 유지보수 아님을 확인한 임시 준비 파일만 정리 자격이 있다(R9). 살아 있는
// 준비(진행 중)가 아니어야 한다. 관측은 파일 시각 하나다.
export function staleTemporary(
  observedAtMs: number,
  nowMs: number,
  graceMs: number,
): boolean {
  return gracePassed(observedAtMs, nowMs, graceMs);
}

// backup이 진행 중인지. backup.pending 표시가 남아 있으면 만들기 중이거나
// 실패한 folder다(T41). GC는 backup 중 불가하고, 이 folder가 담는 blob은
// 물리 삭제 대상에서 뺀다(T41, R11).
export function backupPendingFolders(
  entries: readonly { name: string; pending: boolean }[],
): readonly string[] {
  return entries.filter((entry) => entry.pending).map((entry) => entry.name);
}

// capacity field의 보존 규칙 하나. category는 큰 자료 종류이고, 상한은
// BLOB_CAPACITY_MAX_BYTES다(R13).
export function capacityRuleOf(
  rules: readonly RetentionRule[],
  ownerKind: string,
  field: string,
): Result<{ category: BlobRetentionCategory } | { kind: "permanent" }> {
  const found = rules.find((rule) =>
    rule.owner_kind === ownerKind && rule.field === field
  );
  if (found === undefined) {
    return err({
      code: "invalid_input",
      message: "등록되지 않은 blob field다",
    });
  }
  if (found.retention.kind === "permanent") return ok({ kind: "permanent" });
  return ok({ category: found.retention.category });
}

// R11의 구별. 참조 차단은 GC가 참조 blob을 대상에서 뺀 것이고, 반환 차단은
// general_read가 없는 field(보호 backup 등)다. OS 삭제는 실제 파일 삭제,
// 사본 잔존은 backup 폴더의 나머지 사본이다.
export type GcDisposition =
  // 참조 차단: 참조가 있어 대상에서 빠졌다. 파일은 남는다.
  | { kind: "referenced" }
  // 반환 차단: general_read가 없어 콘텐츠 반환을 막았다. 파일·참조는 그대로다.
  | { kind: "return_blocked" }
  // OS 삭제: 참조가 없어 유예기간 뒤 파일을 지웠다.
  | { kind: "deleted" }
  | { kind: "kept" };

// 종류별 용량 초과 판정(R13). category별 합이 상한을 넘으면 초과다.
// 초과분은 설치량 기준이고, 상한의 대상은 capacity field뿐이다.
export type CapacityUsage = {
  category: BlobRetentionCategory;
  usedBytes: number;
  maxBytes: number;
};

export function capacityUsage(
  rules: readonly RetentionRule[],
  installed: readonly InstalledBlob[],
  // field마다 설치 blob이 어느 owner/field에 속하는지의 관측.
  assignment: ReadonlyMap<string, BlobRetentionCategory>,
): readonly CapacityUsage[] {
  const used = new Map<BlobRetentionCategory, number>();
  for (const rule of rules) {
    if (rule.retention.kind !== "capacity") continue;
    if (!used.has(rule.retention.category)) {
      used.set(rule.retention.category, 0);
    }
  }
  for (const blob of installed) {
    const category = assignment.get(blob.hash);
    if (category === undefined) continue;
    used.set(category, (used.get(category) ?? 0) + blob.sizeBytes);
  }
  const usages: CapacityUsage[] = [];
  for (const category of BLOB_RETENTION_CATEGORIES) {
    if (!used.has(category)) continue;
    usages.push({
      category,
      usedBytes: used.get(category) ?? 0,
      maxBytes: BLOB_CAPACITY_MAX_BYTES[category],
    });
  }
  return usages;
}

// 용량 정리 대상. 초과 종류에서 오래된 것부터 상한 안으로 줄인다(R13).
// 대상은 capacity field의 blob뿐이고, 참조된 큰 자료도 정리 대상이다.
// 변경 기록·결정·확정 결과(retention permanent)는 대상에서 뺀다(R13).
export function trimTargets(
  usage: readonly CapacityUsage[],
  candidates: readonly (InstalledBlob & {
    category: BlobRetentionCategory;
    // 오래된 것부터 정리한다(R13). 등록이 오래된 것이 기준이다.
    registeredAtMs: number;
    // permanent field의 blob은 대상에서 뺀다(R13).
    permanent: boolean;
  })[],
): readonly string[] {
  const byCategory = new Map<BlobRetentionCategory, number>();
  for (const entry of usage) {
    if (entry.usedBytes <= entry.maxBytes) continue;
    byCategory.set(entry.category, entry.usedBytes - entry.maxBytes);
  }
  const targets: string[] = [];
  for (const [category, excess] of byCategory) {
    const ordered = candidates
      .filter((candidate) =>
        candidate.category === category && !candidate.permanent
      )
      .sort((a, b) => a.registeredAtMs - b.registeredAtMs);
    let remaining = excess;
    for (const candidate of ordered) {
      if (remaining <= 0) break;
      targets.push(candidate.hash);
      remaining -= candidate.sizeBytes;
    }
  }
  return targets;
}

// 유효한 종류별 상한. BLOB_CAPACITY_MAX_BYTES에 없는 category는 없다.
export function capacityMax(category: BlobRetentionCategory): number {
  return BLOB_CAPACITY_MAX_BYTES[category];
}
