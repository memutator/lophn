import type { PlaceRef } from "@lophn/protocol/projects";
import type { QuestionOption } from "@lophn/protocol/lophn-agent";
import { moveOptionAction } from "../../tools/questions/mod.ts";

// lophn의 문서 자리 추천. 순수 함수다: IO·시계·model 호출이 없다.
// 문서를 열람한 날짜나 역참조가 바뀐다고 run이 생기지 않는다. 사람이 요청한 run이 이 함수에
// 그 순간의 사실을 넘길 때만 추천이 만들어진다(자동 주기 검토·보고 run 없음).
// 어느 context의 자료로도 잡히지 않은 문서는 호출자가 core의 `context.containing` 읽기(project + path)로
// 얻은 목록을 `containing`에 넘겨 알린다. 이 함수는 읽지 않는다.
// 이동은 선택지의 고정 action이고, 사람이 고르기 전에는 아무것도 바뀌지 않는다.

// run당 추천 문서 수 상한.
export const RECOMMENDATION_LIMIT = 5;

// 보조 근거: 최근 30일 서로 다른 날 열람, 역참조, 자료로 잡은 context 수의 하한.
export const SUPPORT_THRESHOLDS = {
  viewed_days_30d: 4,
  backrefs: 2,
  containing_contexts: 2,
} as const;

export type SupportSignals = {
  viewed_days_30d: number;
  backrefs: number;
  containing_contexts: number;
};

// 호출자가 읽어 넘기는 열람·역참조 수다. context 수는 `containing`에서 센다.
export type PlaceActivity = Omit<SupportSignals, "containing_contexts">;

export type SupportingEvidence = {
  met: ("viewed_days_30d" | "backrefs" | "containing_contexts")[];
  supported: boolean;
};

// 세 조건 중 두 조건을 채우면 보조 근거가 있다. 하나만으로는 부족하다.
export function supportingEvidence(
  signals: SupportSignals,
): SupportingEvidence {
  const met = (Object.keys(SUPPORT_THRESHOLDS) as (keyof SupportSignals)[])
    .filter((key) => signals[key] >= SUPPORT_THRESHOLDS[key]);
  return { met, supported: met.length >= 2 };
}

const SUPPORT_WORDS: Record<SupportingEvidence["met"][number], string> = {
  viewed_days_30d: "opened on 4 or more different days in the last 30 days",
  backrefs: "linked from 2 or more documents",
  containing_contexts: "covered by 2 or more contexts",
};

export type PlaceCandidate = {
  place: PlaceRef;
  // 그 자리에서 쓸 문서 이름(slug). 이름 충돌은 소유 command가 CAS로 막는다.
  name: string;
  // 이 자리를 고른 이유. 줄바꿈을 접어 한 줄로 쓴다.
  reason: string;
  // 선택지에 보일 자리 이름.
  label: string;
};

// 문서의 경로를 계약의 Source로 덮는 활성 context 하나다. core의 `context.containing` 읽기
// (project + path)가 돌려주는 항목의 일부다. 옛 항목·관점 연결이 아니라 계약이 덮는지로 센다.
export type ContainingContext = { context: string; title: string };

export type PlaceTarget = {
  document: string;
  title: string;
  // 선택지를 만든 때 읽은 문서 revision. 이동의 비교 기준이다.
  revision: string;
  hasPlace: boolean;
  // 이 문서의 경로를 Source로 덮는 context들(어느 context의 자료로도 잡히지 않으면 빈 목록).
  // 자리가 없는 문서는 경로가 없어 빈 목록이다.
  containing: readonly ContainingContext[];
  // 앞에 있을수록 좋은 후보다. 비면 이동 선택지를 만들지 않는다.
  candidates: readonly PlaceCandidate[];
  activity?: PlaceActivity;
};

export type QuestionDraft = {
  document: string;
  prompt: string;
  reason: string;
  options: QuestionOption[];
  recommendation: { option_key: string; explanation: string };
};

export type PlaceRecommendations = {
  drafts: QuestionDraft[];
  // 추천 대상이지만 후보를 못 골라 질문을 만들지 않은 문서.
  noCandidate: string[];
  // 상한 때문에 이번 run에서 다루지 않은 문서 수.
  skipped: number;
  // 자리가 있고 어느 context가 덮는 문서는 추천 대상이 아니다.
  notTargets: string[];
};

export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isTarget(target: PlaceTarget): boolean {
  return !target.hasPlace || target.containing.length === 0;
}

function draftOf(target: PlaceTarget): QuestionDraft | undefined {
  const candidates = target.candidates.flatMap((candidate) => {
    const reason = oneLine(candidate.reason);
    return reason === "" ? [] : [{ ...candidate, reason }];
  });
  if (candidates.length === 0) return undefined;
  const options: QuestionOption[] = candidates.map((candidate, index) => ({
    key: `move-${index + 1}`,
    label: `Move to ${oneLine(candidate.label)}`,
    description:
      `Move "${target.title}" to ${candidate.label} as ${candidate.name}. ${candidate.reason}`,
    evidence: [],
    adoption: null,
    action: moveOptionAction({
      document: target.document,
      place: candidate.place,
      name: candidate.name,
      base_revision: target.revision,
    }),
  }));
  options.push({
    key: "leave-it",
    label: "Leave it as it is",
    description: `Keep "${target.title}" where it is. Nothing changes.`,
    evidence: [],
    adoption: null,
    action: null,
  });
  const support = target.activity === undefined
    ? undefined
    : supportingEvidence({
      ...target.activity,
      containing_contexts: target.containing.length,
    });
  const cited = support?.supported
    ? ` It is ${support.met.map((key) => SUPPORT_WORDS[key]).join(" and ")}.`
    : "";
  return {
    document: target.document,
    prompt: `Where should "${target.title}" live?`,
    reason: target.hasPlace
      ? `"${target.title}" is not covered by any context.`
      : `"${target.title}" has no place yet.`,
    options,
    recommendation: {
      option_key: "move-1",
      explanation: `${candidates[0]!.reason}${cited}`,
    },
  };
}

// run 하나의 추천. 대상은 입력 순서대로 최대 5개이고 나머지는 skipped로 센다.
export function recommendPlaces(
  targets: readonly PlaceTarget[],
): PlaceRecommendations {
  const eligible = targets.filter(isTarget);
  const chosen = eligible.slice(0, RECOMMENDATION_LIMIT);
  const drafts: QuestionDraft[] = [];
  const noCandidate: string[] = [];
  for (const target of chosen) {
    const draft = draftOf(target);
    if (draft === undefined) noCandidate.push(target.document);
    else drafts.push(draft);
  }
  return {
    drafts,
    noCandidate,
    skipped: eligible.length - chosen.length,
    notTargets: targets.filter((target) => !isTarget(target)).map((target) =>
      target.document
    ),
  };
}
