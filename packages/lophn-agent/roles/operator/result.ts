import { err, ok, type Result } from "../../../base/mod.ts";

// Operator run 하나의 결과 판정(roles/operator R6, R7, R8). 순수 함수다: IO·시계·model
// 호출이 없다. 실제 읽기·저장은 harness/tools 묶음의 tool과 documents/versions가
// 하고, 이 모듈은 모델이 남긴 결과를 사실·판단·불확실함으로 구분해 무엇이 새
// version이 되는지의 계약만 정한다.

// 결과의 세 구분이다(R6). 확인한 사실과 판단과 불확실함이 섞이지 않는다.
export type OutcomePoint = {
  // 실제로 읽고 확인한 것이다. 고정 근거 주소가 필요하다.
  fact: string;
  // 사실을 비교 기준으로 판단한 것이다.
  judgment: string;
  // 부족한 자료와 아직 정하지 못한 것이다.
  uncertainty: string;
};

// 근거 주소다. 실제로 읽은 고정 판만 근거가 된다.
export type EvidenceAddress = {
  document: string;
  version: string;
  section: string | null;
};

// Operator run 하나의 결과다(R6 표). kind가 하나인 결과 하나다. 선언된 남길 문서만 쓴다.
export type OperatorRunOutcome =
  // 갱신 조건을 충족해 남길 내용이다(R6 표 갱신 결과). 승인된 update_condition에
  // 맞을 때만 새 Version이다.
  | {
    kind: "update";
    points: OutcomePoint;
    evidence: EvidenceAddress[];
    // 선언한 판단 항목이다(R1). prompt에 적은 항목 그대로다.
    declared_items: string[];
    update_condition: string;
  }
  // 실제 저장된 문서·Version과 미저장·실패 내용이다(R6 표 부분). 일부 저장을
  // 전체 성공이나 전체 취소로 표시하지 않는다.
  | {
    kind: "partial";
    points: OutcomePoint;
    evidence: EvidenceAddress[];
    saved: { document: string; version: string }[];
    failed: { document: string; reason: string }[];
  }
  // 사람이 이야기한 의도·취향의 답이다(R8). 승인된 판단 항목에 필요한 답만
  // 승인된 기존 문서의 새 Version에 저장한다.
  | {
    kind: "person_answer";
    points: OutcomePoint;
    evidence: EvidenceAddress[];
    document: string;
  };

// 갱신 조건을 충족했을 때 남길 결과다(R6 표 갱신 결과). 사실·판단·불확실함의 세
// 구분과 고정 근거 주소와 선언한 판단 항목이 모두 있어야 새 Version이다.
export function update(
  output: {
    points: OutcomePoint;
    evidence: EvidenceAddress[];
    declared_items: string[];
    update_condition: string;
  },
): Result<Extract<OperatorRunOutcome, { kind: "update" }>> {
  if (output.update_condition.trim() === "") {
    return err({ code: "invalid_input", message: "update condition is blank" });
  }
  const points = output.points;
  if (points.fact.trim() === "") {
    return err({ code: "invalid_input", message: "checked fact is blank" });
  }
  if (points.judgment.trim() === "") {
    return err({ code: "invalid_input", message: "judgment is blank" });
  }
  if (points.uncertainty.trim() === "") {
    return err({ code: "invalid_input", message: "uncertainty is blank" });
  }
  if (output.evidence.length === 0) {
    return err({ code: "invalid_input", message: "update needs evidence" });
  }
  if (output.declared_items.length === 0) {
    return err({
      code: "invalid_input",
      message: "update needs the declared judgment items",
    });
  }
  return ok({
    kind: "update",
    points,
    evidence: [...output.evidence],
    declared_items: [...output.declared_items],
    update_condition: output.update_condition,
  });
}
