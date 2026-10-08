import {
  type BlobRetentionCategory,
} from "../../contracts/platform/mod.ts";
import {
  BLOB_CAPACITY_MAX_BYTES,
  type RetentionRule,
} from "../../../packages/platform/blob-store/mod.ts";

// 보존 정리의 후보 선정과 보존 판정(observability#R23, R24, R25, R26). 관측 리프는
// 어떤 참조가 큰 자료인지와 어떤 근거가 정리 대상에서 빠져야 하는지를 판정하고,
// 용량 숫자와 실제 파일 삭제는 platform/blob-store 몫이다(R23: platform/blob-store가
// 정하고 실제 삭제도 platform만 한다). 이 파일은 파일·ledger를 열지 않는다.

// 정리 후보 하나. 관측이 등록된 blob 참조의 소유 종류·field로 분류한다(R23:
// 큰 자료 종류만). 참조 행(blob_refs)은 불변이므로 등록 순번이 오래된 순서다.
export type TrimCandidate = {
  hash: string;
  owner_kind: string;
  owner_key: string;
  field: string;
  // 큰 자료의 blob 참조에 붙은 capacity category다(R23). 상한은 platform이 정한다.
  category: BlobRetentionCategory;
  // 등록된 영구 참조의 크기이다. 합이 상한을 넘었는지의 재료다.
  size_bytes: number;
  // 참조 등록 순번이다. 오래된 것부터 정리한다(R23).
  registered_seq: string;
};

// 보존 판정 하나. 영구 보존(변경 기록·결정·확정 결과)인 참조는 정리 대상이
// 아니다(R23), 진행 run·미반영 입력·답·approval 대기·revert 근거인 참조도
// 정리 대상으로 넘기지 않는다(R24).
export type KeepVerdict =
  // 변경 기록·결정·확정 결과(R23: 영구 보존). 참조 field의 보존 규칙이 정한다.
  | { kind: "permanent"; field: string }
  // 진행 run의 근거다(R24: 진행 run을 넘기지 않는다).
  | { kind: "active_run"; run: string }
  // 답을 기다리는 질문의 근거다(R24: 답 대기는 넘기지 않는다).
  | { kind: "pending_answer"; question: string }
  // 승인을 기다리는 approval의 근거다(R24: approval 대기는 넘기지 않는다).
  | { kind: "pending_approval"; approval: string }
  // revert의 근거다(R24: revert 근거는 넘기지 않는다).
  | { kind: "revert_basis"; revert: string };

// 보존 규칙에서 큰 자료(용량 상한 종류) field만 가린다(R23). permanent field는
// 정리 대상이 아니므로 후보 분류에 들지 않는다.
export function capacityFields(
  rules: readonly RetentionRule[],
): readonly { owner_kind: string; field: string; category: BlobRetentionCategory }[] {
  const found: {
    owner_kind: string;
    field: string;
    category: BlobRetentionCategory;
  }[] = [];
  for (const rule of rules) {
    if (rule.retention.kind !== "capacity") continue;
    found.push({
      owner_kind: rule.owner_kind,
      field: rule.field,
      category: rule.retention.category,
    });
  }
  return found;
}

// 등록된 참조 행에서 큰 자료의 정리 후보를 선정한다(R23). capacity field의
// 참조만 후보고, permanent field의 것은 뺀다(변경 기록·결정·확정 결과).
// 같은 observer가 큰 자료가 아닌 종류(document 파일 등)의 참조도 불변으로 남겨
// 두는 것은 platform/blob-store의 규칙이고, 여기서는 큰 자료만 분류해서 넘긴다.
export function trimCandidatesOf(
  rules: readonly RetentionRule[],
  // blob_refs의 참조 행 관측. 등록 순번과 함께 platform/ledger에서 온다.
  references: readonly {
    hash: string;
    owner_kind: string;
    owner_key: string;
    field: string;
    size_bytes: number;
    registered_seq: string;
  }[],
): readonly TrimCandidate[] {
  const capacity = new Map<string, BlobRetentionCategory>();
  for (const field of capacityFields(rules)) {
    capacity.set(`${field.owner_kind}\u0000${field.field}`, field.category);
  }
  const candidates: TrimCandidate[] = [];
  for (const reference of references) {
    const category = capacity.get(
      `${reference.owner_kind}\u0000${reference.field}`,
    );
    if (category === undefined) continue;
    candidates.push({
      hash: reference.hash,
      owner_kind: reference.owner_kind,
      owner_key: reference.owner_key,
      field: reference.field,
      category,
      size_bytes: reference.size_bytes,
      registered_seq: reference.registered_seq,
    });
  }
  // 오래된 것부터(R23): 등록 순번이 앞선 참조가 먼저 정리 대상이다.
  return candidates.sort((a, b) =>
    BigInt(a.registered_seq) < BigInt(b.registered_seq) ? -1 : 1
  );
}

// 진행 run의 정리 후보 제외(R24). 진행 run(accepted·running·waiting_user)이
// 소유한 참조는 유예기간이 무엇이든 정리 대상으로 넘기면 안 된다. run의 근거·
// 결과 blob과 run 안 호출·message의 blob이 모두 그 run의 것이다.
export type ActiveRun = {
  run: string;
  // 진행 run이 소유한 blob hash의 집합. 참조 행의 hash다.
  hashes: readonly string[];
};

// 대기 중 질문(R24: 답 대기). 질문 본문·이유 blob이 대안 없이 사라지면 안 된다.
export type PendingQuestion = {
  question: string;
  hashes: readonly string[];
};

// 대기 중 approval(R24: approval 대기). 생성 근거 blob이 대안 없이 사라지면 안 된다.
export type PendingApproval = {
  approval: string;
  hashes: readonly string[];
};

// 진행 revert(R24: revert 근거). 복원 판정이 참조하는 blob이 사라지면 안 된다.
export type ActiveRevert = {
  revert: string;
  hashes: readonly string[];
};

// 후보 중 보존 판정의 대상에서 빠진 것(남겨야 할 것)을 산다(R24). 같은 hash가
// 여러 참조에서 가리킬 수 있다: 하나라도 보호 근거가 가리키면 후보에서 뺀다.
export function protectedHashes(
  runs: readonly ActiveRun[],
  questions: readonly PendingQuestion[],
  approvals: readonly PendingApproval[],
  reverts: readonly ActiveRevert[],
): ReadonlySet<string> {
  const hashes = new Set<string>();
  for (const run of runs) {
    for (const hash of run.hashes) hashes.add(hash);
  }
  for (const question of questions) {
    for (const hash of question.hashes) hashes.add(hash);
  }
  for (const approval of approvals) {
    for (const hash of approval.hashes) hashes.add(hash);
  }
  for (const revert of reverts) {
    for (const hash of revert.hashes) hashes.add(hash);
  }
  return hashes;
}

// 후보를 넘기기 전 보존 판정(R24). 보호 근거가 가리키는 hash는 대상에서 빠진다.
// 판정은 후보 선정 때 한 번이며, platform의 유예기간 판정을 대신하지 않는다.
export function keepVerdicts(
  candidates: readonly TrimCandidate[],
  protected_: ReadonlySet<string>,
): { targets: readonly TrimCandidate[]; kept: readonly KeepVerdict[] } {
  const targets: TrimCandidate[] = [];
  const kept: KeepVerdict[] = [];
  for (const candidate of candidates) {
    if (protected_.has(candidate.hash)) {
      kept.push({ kind: "active_run", run: candidate.owner_key });
      continue;
    }
    targets.push(candidate);
  }
  return { targets, kept };
}

// 보존 종료로 본문이 사라질 때 platform에 요청하는 부분(R25). derived index·cache
// 제거와 부재 표시는 platform/blob-store·platform/ledger에 요청이고 다른 store의
// 정리를 한 transaction으로 약속하지 않는다(R25). 요청은 hash 목록뿐이다.
export type PruningRequest = {
  // 사라질(사라진) 본문의 hash다.
  hashes: readonly string[];
};

// 정리 대상 hash의 platform 요청(R25). 부재 표시와 derived 정리는 요청만 하고
// 실제 파일 삭제·표 삭제는 platform 몫이다.
export function pruningRequest(
  targets: readonly TrimCandidate[],
): PruningRequest {
  const hashes = new Set<string>();
  for (const target of targets) hashes.add(target.hash);
  return { hashes: [...hashes] };
}

// 정리 대상에서 뺀 변경 주체의 최소 식별(R26). run·호출이 정리 종료로 사라져도
// run id·호출 id·assignment 같은 최소 식별은 참조가 살아 있는 동안 남는다(문서·
// release 삭제로 번지지 않는다: 이 파일은 documents·apps의 어떤 것도 가리키지
// 않는다). 문서 자체가 지워지지 않는 확인이 아니라, 정리 대상 분류가 문서·release
// owner 종류를 아예 큰 자료로 세지 않는다는 확인이다(R26).
export function excludesSubjects(
  candidates: readonly TrimCandidate[],
): { documents: number; releases: number } {
  const seen = new Set<string>();
  let documents = 0;
  let releases = 0;
  for (const candidate of candidates) {
    const key = `${candidate.owner_kind}\u0000${candidate.owner_key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (candidate.owner_kind === "document" || candidate.owner_kind.startsWith("document_")) {
      documents += 1;
    } else if (candidate.owner_kind === "release" || candidate.owner_kind.startsWith("release_")) {
      releases += 1;
    }
  }
  return { documents, releases };
}

// 큰 자료 category의 상한이다. 숫자는 platform/blob-store가 정한 값이고 여기서는
// 판정 재료로만 본다(R23: 용량 숫자는 platform가 정한다).
export function capacityLimit(category: BlobRetentionCategory): number {
  return BLOB_CAPACITY_MAX_BYTES[category];
}
