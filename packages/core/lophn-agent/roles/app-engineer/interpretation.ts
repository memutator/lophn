import { err, ok, type Result } from "../../../../base/mod.ts";

// App Engineer의 문제 해석과 release 검토 규칙.
// 순수 함수다: IO·시계·model 호출이 없다. 문제 상태 변경(연결·해제)의 소유 규칙은
// problems/grouping의 LinkProblemInterpretation command가 정하고, 버전·절 참조의 존재 확인은
// problems/grouping의 checkInterpretationLink(문서 읽기 주입)가 한다. 이 모듈은 해석 설계와
// release 검토에서 무엇을 정하고 무엇을 사람에게 묻는지의 모양만 정한다.

// 관측 설계가 정하는 것. 사용자에게 어떤 일이 문제인지·어떤 해결이 필요한지·수리 중
// 보존할 동작뿐이다. 발생 집계·해결 확인·문제 닫힘은 관측 설계가 정하는 대상이 아니다: 해결의
// 실제 사실은 실제 문제 상태와 test result가 남기고, 집계는 문제 표의 보고 수다.
export type ObservationDesign = {
  // 사용자에게 어떤 일이 문제인지.
  what_is_wrong: string;
  // 어떤 해결이 필요한지.
  what_resolution: string;
  // 수리 중 보존할 동작.
  preserved_behaviors: string[];
};

// 관측 설계가 처리하지 않는 대상. 관측 설명은 문제 상태나 test result를 바꾸지 않는다.
export type ObservationExcluded =
  | "aggregation"
  | "resolution_confirm"
  | "closing";

// 관측 설계의 검사. 정의 부분이 있고 처리한 대상이 정의 안에 없어야 한다.
export function checkObservationDesign(
  design: ObservationDesign,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (design.what_is_wrong.trim() === "") {
    problems.push("what is wrong missing");
  }
  if (design.what_resolution.trim() === "") {
    problems.push("what resolution is missing");
  }
  if (design.preserved_behaviors.length === 0) {
    problems.push("preserved behavior is missing");
  }
  return { ok: problems.length === 0, problems };
}

// 문제 해석의 원인 가설. 현재 문제·snapshot·설계·release 이력·실제 test result의 비교로
// 좁힌 가설 하나다. 지지·반박 근거와 부족한 자료·다음 확인을 함께 남긴다.
export type CauseHypothesis = {
  cause: string;
  // 이 가설을 지지하는 고정 근거.
  supports: BasisReferenceLike[];
  // 이 가설을 반박하는 고정 근거.
  contradicts: BasisReferenceLike[];
  // 가설을 좁히는 데 부족한 자료.
  missing_evidence: string[];
  // 다음에 확인할 것.
  next_checks: string[];
};

export type BasisReferenceLike = { document: string; version: string };

// 원인 가설의 최대 수. 넘으면 하나로 좇고 나머지는 부족한 근거의 설명으로 돌린다.
export const HYPOTHESIS_MAX = 3;

// 원인 가설들의 검사. 가설은 최대 3개까지 좇고, 확인되지 않은 가설은 확인됨으로 쓰지
// 않는다. 네 번째 가설 대신 부족한 근거를 설명한다.
export function checkHypotheses(
  hypotheses: readonly CauseHypothesis[],
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (hypotheses.length === 0) problems.push("cause hypothesis is missing");
  if (hypotheses.length > HYPOTHESIS_MAX) {
    problems.push(`hypotheses exceed ${HYPOTHESIS_MAX}`);
  }
  for (const hypothesis of hypotheses) {
    if (hypothesis.cause.trim() === "") {
      problems.push("a hypothesis has no cause");
    }
    if (hypothesis.next_checks.length === 0) {
      problems.push(`hypothesis without next check: ${hypothesis.cause}`);
    }
    // 지지 근거가 없는 가설은 부족한 자료의 설명이 필요하다. 실제로 없는 테스트를 통과로
    // 쓰지 않는다.
    if (
      hypothesis.supports.length === 0 &&
      hypothesis.missing_evidence.length === 0
    ) {
      problems.push(
        `hypothesis without support explains no missing evidence: ${hypothesis.cause}`,
      );
    }
  }
  return { ok: problems.length === 0, problems };
}

// 초과 가설을 내려 미가설 항목으로 접는다. 네 번째 가설은 가설이 아니라 부족한 근거의
// 설명으로 남는다: 초과한 가설의 원인 문장을 부족한 자료 설명에 더하고 가설은 3개로 좇는다.
export function narrowHypotheses(
  hypotheses: readonly CauseHypothesis[],
): { hypotheses: CauseHypothesis[]; exceeded: string[] } {
  if (hypotheses.length <= HYPOTHESIS_MAX) {
    return {
      hypotheses: [...hypotheses],
      exceeded: [],
    };
  }
  const kept = hypotheses.slice(0, HYPOTHESIS_MAX);
  return {
    hypotheses: kept,
    exceeded: hypotheses.slice(HYPOTHESIS_MAX).map((hypothesis) =>
      hypothesis.cause
    ),
  };
}

// 해석 문서의 참조 모양. 고정 version·절 참조뿐이다. 절이 없으면 판 전체다.
export const interpretationLinkOf = (
  version: string,
  section: string | null = null,
) => ({ version, section });

// 담당 앱 문제의 해석 참조 설정. 고정 참조의 검사는 problems/grouping의
// checkInterpretationLink가 하고, 문제 상태는 변경되지 않는다.
export type InterpretationWrite = {
  problem: string;
  // 해석 문서의 고정 version·절 참조. null이면 연결을 해제한다.
  interpretation: { version: string; section: string | null } | null;
  // 모델의 해석 판단 문장. linking 해설이다.
  explanation: string;
};

// 해석 참조 설정의 검사. 연결은 문제 정의 부분을 건드리지 않는다: 해석은 인자로 문서
// 근거를 남기고 문제 상태(claim·닫힘)는 그대로다. 설명이 없는 연결은 남은 근거가 없다.
export function checkInterpretationWrite(
  write: InterpretationWrite,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (write.problem.trim() === "") problems.push("problem is missing");
  if (write.explanation.trim() === "") {
    problems.push("the linking needs an explanation");
  }
  if (
    write.interpretation !== null &&
    (write.interpretation.version.trim() === "" ||
      write.interpretation.section !== null &&
        write.interpretation.section.trim() === "")
  ) {
    problems.push("the interpretation link needs a version");
  }
  return { ok: problems.length === 0, problems };
}

// release 검토의 대상. 실제 release·정상 여부·invocation·test result를 저장된 설계에
// 대조한다.
export type ReleaseReview = {
  release: string;
  // 저장된 설계와 비교한 실제 release 상태.
  release_status: Record<string, unknown>;
  // 정상 신호.
  health: Record<string, unknown>;
  // 기록된 command 호출.
  invocations: Record<string, unknown>[];
  // 기록된 test result.
  verifications: Record<string, unknown>[];
  // 저장된 설계 문서의 고정 참조.
  design: BasisReferenceLike[];
};

// release 검토 결과. 의미상 어긋남과 후속 티켓 후보를 남긴다.
export type ReleaseReviewMemo = {
  // 저장된 설계와 실제 release의 의미상 어긋남. 확인 근거와 불일치가 나뉜다.
  divergences: { what: string; check_evidence: string[] }[];
  // 후속 티켓 후보.
  ticket_candidates: string[];
  // 설계 적용의 새 결정. 사람에게 먼저 묻는다.
  decision_needed: string[];
};

// release 검토의 검사. 검토 메모에 확인 근거가 나뉘고 새 결정은 사람에게 묻는다. 설계나
// release를 바꾸지 않는다.
export function checkReleaseReview(
  memo: ReleaseReviewMemo,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  for (const divergence of memo.divergences) {
    if (divergence.check_evidence.length === 0) {
      problems.push(`a divergence without check evidence: ${divergence.what}`);
    }
  }
  // 새 결정은 사람에게 묻는다. 검토가 설계·release를 바꾸지 않는다.
  if (memo.decision_needed.length > 0) {
    problems.push(
      "a new decision needs a person's answer before design or release changes",
    );
  }
  return { ok: problems.length === 0, problems };
}

// SDK 변경의 몫. lophn이 맡긴 계획 중 담당 앱 영향만 설계 변경·구현 티켓으로 내린다.
// SDK 자체 수정과 전체 앱 적용 순서는 lophn-agent/roles/lophn으로 안내한다.
export type SdkChange = {
  // lophn이 맡긴 계획의 영향. 한 앱 영향이면 설계 변경·구현 ticket으로 남긴다.
  app_impact: string;
  // 영향이 설계 변경인지 구현 ticket인지이다. 사람이 정한 것을 반복하지 않는다.
  route: "design_change" | "implementation_ticket";
};

// SDK 변경의 판정. 담당 앱 영향과 응답 route가 있어야 하고, SDK 자체 수정·전체 앱
// 적용 순서는 맡지 않는다.
export function routeSdkChange(
  change: SdkChange,
): Result<{ route: SdkChange["route"] }> {
  if (change.app_impact.trim() === "") {
    return err({ code: "invalid_input", message: "앱 영향이 없다" });
  }
  return ok({ route: change.route });
}
