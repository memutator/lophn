// 준비 목적 기록의 순수 규칙. IO 없음.
// 준비가 purpose를 남기고, 정지 유지보수의 trimCapacity가 그 기록으로
// hash → capacity category 할당을 산다. ledger blob_refs는 불변 보호라
// purpose를 넣지 못한다. 참조 행이 있으면
// 참조 field의 규칙이 보존을 정하고, 없으면 목적 기록의 purpose로 판정한다.
// 모르는 것은 지우지 않는다(fail-closed): 기록도 규칙도 없는 hash는 bonus
// permanent로 뺀다. trimCapacity의 할당 밖 category는 invalid_input이라
// category 문자열은 상한의 4종 안에서만 만든다.

import { err, ok, type Result } from "../../../base/mod.ts";
import { BLOB_CAPACITY_MAX_BYTES, type RetentionRule } from "./gc.ts";
import { isSha256Hash } from "./unreferenced.ts";
import type { BlobRetentionCategory } from "../../../protocol/storage/mod.ts";

// 목적 기록 하나의 모양. 준비가 성공한 hash의 purpose만 남긴다.
type PurposeRecord = {
  purpose: string;
};

// 목적 기록 폴더. 구분력은 hash 앞 2자 폴더가 정하고 이름은 나머지 62자다.
const PURPOSES_DIR = "blobs/purposes";
const PURPOSE_PREFIX_CHARS = 2;

// hash의 목적 기록 경로. sha256 64-hex 밖은 거절한다(invalid_input).
export function purposesPathFor(root: string, hash: string): Result<string> {
  if (!isSha256Hash(hash)) {
    return err({
      code: "invalid_input",
      message: "blob hash가 sha256 64-hex가 아니다",
    });
  }
  return ok(
    `${root}/${PURPOSES_DIR}/${hash.slice(0, PURPOSE_PREFIX_CHARS)}/${hash.slice(
      PURPOSE_PREFIX_CHARS,
    )}.json`,
  );
}

// purpose를 capacity category로 옮긴다. 규칙 밖 purpose면 undefined다.
// app_bundle 같은 참조 등록 목적은 category가 없어
// 정리 대상이 아니다(상한은 capacity field의 blob뿐이다).
function categoryOfPurpose(
  rules: readonly RetentionRule[],
  purpose: string,
): BlobRetentionCategory | undefined {
  const found = rules.find(
    (rule) => rule.retention.kind === "capacity" && rule.field === purpose,
  );
  if (found === undefined || found.retention.kind !== "capacity") {
    return undefined;
  }
  return found.retention.category;
}

// 목적 기록 JSON을 검사한다. 모양이 다르면 undefined다(fail-closed).
export function parsePurposeRecord(raw: unknown): PurposeRecord | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const purpose = (raw as Record<string, unknown>)["purpose"];
  if (typeof purpose !== "string" || !/^[a-z][a-z0-9_]*$/.test(purpose)) {
    return undefined;
  }
  return { purpose };
}

type AssignmentEntry = { category: string; permanent: boolean };

// trimCapacity의 할당을 산다. 두 근거:
// - 참조 행(blob_refs의 hash → owner_kind/field)이 있으면 그 field 규칙.
//   영구 참조 blob은 capacity 상한의 대상이 아니므로 permanent다.
// - 참조가 없으면 목적 기록의 purpose로: capacity 목적은 그 category,
//   목록 등록 같은 규칙 밖 목적은 permanent(모르는 것은 지우지 않는다).
// 규칙 밖 category 문자열은 만들지 않는다(상한의 4종만).
export function assignmentOf(
  rules: readonly RetentionRule[],
  // blob_refs의 참조 행 관측. 정지 유지보수에서 읽었다.
  references: readonly { hash: string; owner_kind: string; field: string }[],
  // 목적 기록 관측. hash → purpose.
  purposes: ReadonlyMap<string, string>,
): Map<string, AssignmentEntry> {
  const assignment = new Map<string, AssignmentEntry>();
  const permanentFallback = PERMANENT_CATEGORY;
  for (const reference of references) {
    const rule = rules.find(
      (candidate) =>
        candidate.owner_kind === reference.owner_kind &&
        candidate.field === reference.field,
    );
    if (rule === undefined) continue;
    if (rule.retention.kind === "permanent") {
      assignment.set(reference.hash, {
        category: permanentFallback,
        permanent: true,
      });
      continue;
    }
    assignment.set(reference.hash, {
      category: rule.retention.category,
      permanent: false,
    });
  }
  for (const [hash, purpose] of purposes) {
    if (assignment.has(hash)) continue;
    const category = categoryOfPurpose(rules, purpose);
    assignment.set(
      hash,
      category === undefined
        ? { category: permanentFallback, permanent: true }
        : { category, permanent: false },
    );
  }
  return assignment;
}

// permanent 표시에 쓸 category. trimCapacity는 permanent flag의 존재로
// 대상에서 빼므로 flag의 category 문자열은 실제로 쓰이지 않는다. 다만
// trimCapacity의 할당 검사가 상한 밖 category를 거절하므로 상한 안의
// 것을 하나 고른다(4종의 첫 번째).
const PERMANENT_CATEGORY = Object.keys(BLOB_CAPACITY_MAX_BYTES)[0];

// 상한의 유효 category.
