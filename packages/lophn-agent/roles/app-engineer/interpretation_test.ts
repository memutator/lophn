import { assert, assertEquals } from "@std/assert";
import { problemSetInterpretationTool } from "../../harness/tools/mod.ts";
import {
  type BasisReferenceLike,
  type CauseHypothesis,
  checkHypotheses,
  checkInterpretationWrite,
  checkObservationDesign,
  checkReleaseReview,
  HYPOTHESIS_MAX,
  type InterpretationWrite,
  narrowHypotheses,
  type ObservationDesign,
  type ReleaseReviewMemo,
  routeSdkChange,
  type SdkChange,
} from "./mod.ts";

// roles/app-engineer의 문제 해석과 release 검토 규칙(R13–R15, R18, R19). 순수 규칙과
// 해석 참조 설정 ToolCall의 command 전 read 단계를 본다. 실제 provider와 사람 데이터
// root는 열지 않는다(model 호출이 없는 규칙이다). 문제 상태 변경의 소유 규칙은
// problems/grouping의 command가 맡는다.

const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const VER = "ver_01arz3ndektsv4rrffq69g5fav";
const PROBLEM = "prb_01arz3ndektsv4rrffq69g5fav";

// --- R13: 관측 설계는 문제 정의·보존 동작만 -----------------------------------------

Deno.test("lophn-agent/roles/app-engineer#R13: 관측 설계는 어떤 일이 문제인지·어떤 해결이 필요한지·보존할 동작만 정한다", () => {
  const design: ObservationDesign = {
    what_is_wrong: "보고서 저장 누름이 500으로 끝난다",
    what_resolution: "저장 눔 상태 이후의 예외를 잡는다",
    preserved_behaviors: ["보고서 목록은 그대로 유지된다"],
  };
  const checked = checkObservationDesign(design);
  assert(checked.ok, checked.problems.join(", "));
});

Deno.test("lophn-agent/roles/app-engineer#R13: 관측 설계의 정의 부분이 없으면 문제로 남는다", () => {
  const missing: ObservationDesign = {
    what_is_wrong: "보고서 저장 누름이 500으로 끝난다",
    what_resolution: "",
    preserved_behaviors: [],
  };
  const checked = checkObservationDesign(missing);
  assertEquals(checked.ok, false);
  assert(checked.problems.includes("what resolution is missing"));
  assert(checked.problems.includes("preserved behavior is missing"));
});

// --- R14: 원인 가설은 최대 3개로 좁히고 부족 자료를 설명한다 -----------------------

const basis = (n: number): BasisReferenceLike => ({
  document: `${DOC}${n}`,
  version: VER,
});

function hypothesis(over: Partial<CauseHypothesis> = {}): CauseHypothesis {
  return {
    cause: "저장 handler가 예외를 잡지 않는다",
    supports: [basis(1)],
    contradicts: [],
    missing_evidence: [],
    next_checks: ["app log에서 예외 스택을 본다"],
    ...over,
  };
}

Deno.test("lophn-agent/roles/app-engineer#R14: 원인 가설은 최대 3개로 좁히고 지지·반박 근거와 다음 확인을 남긴다", () => {
  const hypotheses = [
    hypothesis(),
    hypothesis({
      cause: "blob 등록이 실패한다",
      supports: [],
      missing_evidence: ["blob store의 최근 오류"],
    }),
    hypothesis({
      cause: "release가 낡은 blueprint를 쓴다",
      contradicts: [basis(2)],
    }),
  ];
  const checked = checkHypotheses(hypotheses);
  assert(checked.ok, checked.problems.join(", "));
});

Deno.test("lophn-agent/roles/app-engineer#R14: 네 번째 가설은 가설로 좇지 않고 부족한 근거의 설명으로 남는다", () => {
  const four = [
    hypothesis(),
    hypothesis({ cause: "blob 등록이 실패한다" }),
    hypothesis({ cause: "release가 낡은 blueprint를 쓴다" }),
    hypothesis({ cause: "네 번째 가설이다" }),
  ];
  const checked = checkHypotheses(four);
  assertEquals(checked.ok, false);
  assert(
    checked.problems.some((problem) =>
      problem.includes(`exceed ${HYPOTHESIS_MAX}`)
    ),
  );
  const narrowed = narrowHypotheses(four);
  assertEquals(narrowed.hypotheses.length, HYPOTHESIS_MAX);
  assertEquals(narrowed.exceeded, ["네 번째 가설이다"]);
});

Deno.test("lophn-agent/roles/app-engineer#R14: 지지 근거도 부족 자료 설명도 없는 가설은 확인되지 않은 가설이다", () => {
  const weak = [
    hypothesis({ supports: [], missing_evidence: [] }),
  ];
  const checked = checkHypotheses(weak);
  assertEquals(checked.ok, false);
  assert(
    checked.problems.some((problem) =>
      problem.includes("explains no missing evidence")
    ),
  );
});

Deno.test("lophn-agent/roles/app-engineer#R14: 가설이 하나도 없으면 문제로 남는다", () => {
  const checked = checkHypotheses([]);
  assertEquals(checked.ok, false);
  assert(checked.problems.includes("cause hypothesis is missing"));
});

// --- R15: 해석 문서는 고정 version·절 참조만 설정한다 ------------------------------

Deno.test("lophn-agent/roles/app-engineer#R15: 해석 참조 설정은 고정 version·절 참조의 설명을 남긴다", () => {
  const write: InterpretationWrite = {
    problem: PROBLEM,
    interpretation: { version: VER, section: "cause" },
    explanation: "원인 가설의 절을 근거로 연결한다",
  };
  const checked = checkInterpretationWrite(write);
  assert(checked.ok, checked.problems.join(", "));
});

Deno.test("lophn-agent/roles/app-engineer#R15: 설명 없는 연결은 문제로 남는다", () => {
  const write: InterpretationWrite = {
    problem: PROBLEM,
    interpretation: { version: VER, section: null },
    explanation: "",
  };
  const checked = checkInterpretationWrite(write);
  assertEquals(checked.ok, false);
  assert(checked.problems.includes("the linking needs an explanation"));
});

Deno.test("lophn-agent/roles/app-engineer#R15: 해석 참조 설정 tool은 문제 상태를 바꾸지 않는다", () => {
  // tool의 소유 contract는 LinkProblemInterpretation이다. 문제 상태(claim·닫힘)를
  // 바꾸는 동작은 그 command 밖이다.
  assertEquals(
    problemSetInterpretationTool.contract,
    "LinkProblemInterpretation",
  );
  assertEquals(problemSetInterpretationTool.effect, "write");
  assertEquals(problemSetInterpretationTool.confirm, false);
});

// --- R18: release 검토의 어긋남과 새 결정은 사람에게 --------------------------------

Deno.test("lophn-agent/roles/app-engineer#R18: release 검토 메모의 어긋남은 확인 근거와 나뉘고 후속 ticket 후보를 남긴다", () => {
  const memo: ReleaseReviewMemo = {
    divergences: [{
      what: "설계된 정상 신호가 release에서 보이지 않는다",
      check_evidence: ["app.health 읽기가 ready 아님을 보인다"],
    }],
    ticket_candidates: ["정상 신호를 회복하는 repair ticket"],
    decision_needed: [],
  };
  const checked = checkReleaseReview(memo);
  assert(checked.ok, checked.problems.join(", "));
});

Deno.test("lophn-agent/roles/app-engineer#R18: 확인 근거 없는 어긋남은 문제로 남는다", () => {
  const memo: ReleaseReviewMemo = {
    divergences: [{ what: "설계와 다르다", check_evidence: [] }],
    ticket_candidates: [],
    decision_needed: [],
  };
  const checked = checkReleaseReview(memo);
  assertEquals(checked.ok, false);
  assert(
    checked.problems.some((problem) =>
      problem.includes("without check evidence")
    ),
  );
});

Deno.test("lophn-agent/roles/app-engineer#R18: 설계 적용의 새 결정은 사람에게 먼저 묻는다", () => {
  const memo: ReleaseReviewMemo = {
    divergences: [],
    ticket_candidates: [],
    decision_needed: ["설계를 새 해결 의미로 고칠지 사람이 정한다"],
  };
  const checked = checkReleaseReview(memo);
  assertEquals(checked.ok, false);
  assert(
    checked.problems.some((problem) =>
      problem.includes("needs a person's answer")
    ),
  );
});

// --- R19: SDK 변경은 담당 앱 영향만 -------------------------------------------------

Deno.test("lophn-agent/roles/app-engineer#R19: SDK 변경의 영향은 담당 앱 영향과 응답 route로 남는다", () => {
  const design: SdkChange = {
    app_impact: "저장 응답 형식이 바뀐다",
    route: "design_change",
  };
  const ticket: SdkChange = {
    app_impact: "저장 응답 형식이 바뀐다",
    route: "implementation_ticket",
  };
  const designRouted = routeSdkChange(design);
  assert(designRouted.ok, designRouted.ok ? "" : designRouted.error.message);
  assertEquals(designRouted.value.route, "design_change");
  const ticketRouted = routeSdkChange(ticket);
  assert(ticketRouted.ok, ticketRouted.ok ? "" : ticketRouted.error.message);
  assertEquals(ticketRouted.value.route, "implementation_ticket");
});

Deno.test("lophn-agent/roles/app-engineer#R19: 앱 영향 없는 SDK 변경은 받지 않는다", () => {
  const change: SdkChange = { app_impact: "", route: "design_change" };
  const routed = routeSdkChange(change);
  assertEquals(routed.ok, false);
});
