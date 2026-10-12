import type {
  BlobFieldDefinition,
  BlobRetentionCategory,
} from "../../../protocol/platform/mod.ts";

// trace 보존 정리의 판정(observability#R23, R24, R25, R26). trace는 저장하지 않으므로 이 leaf가
// 정하는 것은 어떤 본문이 정리 대상인지, 무엇을 platform에 넘기면 안 되는지, 정리 뒤 무엇을
// 요청하는지다. 용량 숫자와 실제 삭제는 platform/blob-store·platform/ledger가 한다(R23).
// 이 파일은 파일·ledger를 열지 않고 상한 숫자도 두지 않는다.

// 등록 field의 정리 분류다(R23). 큰 자료 종류만 정리 후보가 되고 변경 기록·결정·확정 결과
// (retention permanent)는 대상 자체가 아니다.
export type TrimField = {
  owner_kind: string;
  field: string;
  category: BlobRetentionCategory;
};

// agent가 등록한 field에서 큰 자료 field만 가린다(R23). 종류별 용량 상한은 platform/blob-store가
// 정하므로 여기서는 종류만 본다.
export function capacityFields(
  fields: readonly BlobFieldDefinition[],
): readonly TrimField[] {
  const found: TrimField[] = [];
  for (const field of fields) {
    if (field.retention.kind !== "capacity") continue;
    found.push({
      owner_kind: field.owner_kind,
      field: field.field,
      category: field.retention.category,
    });
  }
  return found;
}

// blob_refs의 참조 행 하나의 관측이다. 정지 유지보수가 고정 blob_refs 전체에서 읽어 넣는다
// (platform/blob-store#R8).
export type TrimReference = {
  hash: string;
  owner_kind: string;
  owner_key: string;
  field: string;
  size_bytes: number;
  // 참조 등록 순번이다. 오래된 것부터 정리하는 근거다(R23).
  registered_seq: string;
};

// 정리 후보 하나다(R23). 본문 크기를 함께 들고 가지만 어디까지 자를지는 platform이 정한다:
// 이 leaf는 상한을 모르고 합계도 내지 않는다.
export type TrimCandidate = {
  hash: string;
  owner_kind: string;
  owner_key: string;
  field: string;
  category: BlobRetentionCategory;
  size_bytes: number;
  registered_seq: string;
};

// 큰 자료 참조만 정리 후보로 고른다(R23). permanent field(변경 기록·결정·확정 결과)의 참조는
// 후보가 아니고, 넘겨받은 agent 등록 field 밖의 참조(문서·release 등 다른 concern 소유)도
// 들어오지 않는다(R26: 정리가 그 둘의 삭제로 번지지 않는다). 순서는 등록 순번이 앞선 것부터다
// (R23: 오래된 것부터).
export function trimCandidatesOf(
  fields: readonly BlobFieldDefinition[],
  references: readonly TrimReference[],
): readonly TrimCandidate[] {
  const capacity = new Map<string, BlobRetentionCategory>();
  for (const field of capacityFields(fields)) {
    capacity.set(`${field.owner_kind}\u0000${field.field}`, field.category);
  }
  const candidates: TrimCandidate[] = [];
  for (const reference of references) {
    const category = capacity.get(
      `${reference.owner_kind}\u0000${reference.field}`,
    );
    if (category === undefined) continue;
    candidates.push({ ...reference, category });
  }
  return candidates.sort((a, b) => {
    const left = BigInt(a.registered_seq);
    const right = BigInt(b.registered_seq);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

// 정리 대상으로 넘기지 않는 근거 하나다(R24). 진행 run·미반영 입력·답 대기·approval 대기·
// revert 근거를 서로 구별해 남긴다.
export type KeepVerdict =
  | { kind: "active_run"; run: string }
  | { kind: "unreflected_input"; message: string }
  | { kind: "pending_answer"; question: string }
  | { kind: "pending_approval"; approval: string }
  | { kind: "revert_basis"; revert: string };

// 보호 근거 하나와 그것이 가리키는 본문 hash들이다. 같은 hash가 여러 근거에 걸릴 수 있다.
export type Protection = {
  verdict: KeepVerdict;
  hashes: readonly string[];
};

// 후보에서 빠진 것과 그 근거다(R24: 만료 후보에 대기·revert 근거가 섞여도 보호 대상으로 구별된다).
export type KeptCandidate = { hash: string; verdict: KeepVerdict };

// 보호 근거가 가리키는 hash를 후보에서 뺀다(R24). 정리 후보를 고르는 쪽(agent runtime)이 대상을
// platform에 넘기기 전에 부른다. 근거가 가리키는 hash는 어느 것도 넘기지 않는다.
export function keepVerdicts(
  candidates: readonly TrimCandidate[],
  protections: readonly Protection[],
): { targets: readonly TrimCandidate[]; kept: readonly KeptCandidate[] } {
  const protectedHashes = new Map<string, KeepVerdict>();
  for (const protection of protections) {
    for (const hash of protection.hashes) {
      if (!protectedHashes.has(hash)) {
        protectedHashes.set(hash, protection.verdict);
      }
    }
  }
  const targets: TrimCandidate[] = [];
  const kept: KeptCandidate[] = [];
  for (const candidate of candidates) {
    const verdict = protectedHashes.get(candidate.hash);
    if (verdict === undefined) targets.push(candidate);
    else kept.push({ hash: candidate.hash, verdict });
  }
  return { targets, kept };
}

// 정리 대상 본문에 대해 platform에 요청하는 것이다(R25). derived index·cache 제거와 부재 표시는
// 요청일 뿐이고 실제 파일·표 삭제는 platform/blob-store·platform/ledger가 한다.
export type PruningRequest = {
  // 본문이 사라질 hash들이다. 오래된 것부터이고 중복은 없다.
  hashes: readonly string[];
  // 원문을 담은 derived index·cache의 제거 요청이다(R25).
  remove_derived: readonly ["index", "cache"];
  // 남은 참조가 내용 부재를 표시하게 하는 요청이다(R25).
  mark_absence: true;
  // store마다 따로 진행한다: 다른 store의 정리를 한 transaction으로 약속하지 않는다(R25).
  atomic: false;
};

export function pruningRequest(
  targets: readonly TrimCandidate[],
): PruningRequest {
  const hashes = new Set<string>();
  for (const target of targets) hashes.add(target.hash);
  return {
    hashes: [...hashes],
    remove_derived: ["index", "cache"],
    mark_absence: true,
    atomic: false,
  };
}

// 정리 뒤에도 남는 변경 주체의 최소 식별이다(R26). 본문이 사라져도 참조 행이 가리키는 id는 남아
// 저자를 구별할 수 있다. 본문·hash·field는 들어가지 않는다.
export type SubjectIdentity = { owner_kind: string; owner_key: string };

// 정리 대상에서 남는 최소 식별을 뽑는다(R26). 그 과정에서 만든 문서·release는 agent 등록 field가
// 아니라 정리 대상이 아니므로(trimCandidatesOf) 이 목록에도 그 삭제로도 번지지 않는다.
export function subjectIdentities(
  targets: readonly TrimCandidate[],
): readonly SubjectIdentity[] {
  const seen = new Set<string>();
  const subjects: SubjectIdentity[] = [];
  for (const target of targets) {
    const key = `${target.owner_kind}\u0000${target.owner_key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    subjects.push({
      owner_kind: target.owner_kind,
      owner_key: target.owner_key,
    });
  }
  return subjects;
}

// 정리 판정 하나다(R23, R24, R25, R26). 정리 후보를 고르는 쪽이 이 함수 하나로 platform에 넘길
// 대상, 넘기지 않은 것과 근거, 정리 뒤 요청, 남는 최소 식별을 얻는다. 삭제는 하지 않는다.
export type TrimPlan = {
  // platform에 넘길 정리 대상이다. 오래된 것부터다(R23).
  targets: readonly TrimCandidate[];
  // 넘기지 않은 것과 그 근거다(R24).
  kept: readonly KeptCandidate[];
  // 대상 본문의 derived 정리·부재 표시 요청이다(R25).
  request: PruningRequest;
  // 정리 뒤에도 남는 변경 주체의 최소 식별이다(R26).
  subjects: readonly SubjectIdentity[];
};

export function trimPlan(
  fields: readonly BlobFieldDefinition[],
  references: readonly TrimReference[],
  protections: readonly Protection[],
): TrimPlan {
  const { targets, kept } = keepVerdicts(
    trimCandidatesOf(fields, references),
    protections,
  );
  return {
    targets,
    kept,
    request: pruningRequest(targets),
    subjects: subjectIdentities(targets),
  };
}
