// phroner 예시 project의 고정 데이터와, 데이터에서 탭·문서 경로를 만드는 작은 함수들.
// 도메인 객체(Finding·Scenario·Experiment)는 따로 탭이 없다. 누르면 그 객체의 문서가 문서 탭으로 열린다.
import type { FileInit } from "./project-files/file-data.ts";
import type { TabSpec } from "./project-window.tsx";

export interface FindingRow {
  id: string;
  title: string;
  kind: "improvement" | "regression";
  scenario: string;
  effect: string;
  experiment: string;
}

const row = (
  id: string,
  title: string,
  kind: FindingRow["kind"],
  scenario: string,
  effect: string,
  experiment: string,
): FindingRow => ({ id, title, kind, scenario, effect, experiment });

// 먼저 만진 순서. 첫 page에 F-009가 보인다.
export const FINDINGS: readonly FindingRow[] = [
  row(
    "F-009",
    "읽고 멈추는 과제에서 월드 행동 시도가 사라진다",
    "improvement",
    "query-leave-still",
    "world_actions 3 → 0",
    "exp-008",
  ),
  row(
    "F-010",
    "상자 이름을 묻는 과제에서 불필요한 열기 호출이 줄었다",
    "improvement",
    "query-chest-name",
    "tool_calls 5 → 2",
    "exp-008",
  ),
  row(
    "F-011",
    "레시피 빈틈을 묻는 과제에서 오답이 늘었다",
    "regression",
    "query-recipe-gap",
    "answer_match 0.8 → 0.6",
    "exp-008",
  ),
  row(
    "F-013",
    "길 찾기 과제의 단계 수가 줄었다",
    "improvement",
    "query-route-plan",
    "steps 12 → 7",
    "exp-011",
  ),
  row(
    "F-014",
    "상자 이름 과제의 호출이 한 번 더 줄었다",
    "improvement",
    "query-chest-name",
    "tool_calls 4 → 3",
    "exp-011",
  ),
  row(
    "F-001",
    "일정 도구가 같은 요청을 두 번 보내지 않는다",
    "improvement",
    "sched-basic",
    "retries 4 → 1",
    "exp-005",
  ),
  row(
    "F-002",
    "일정 겹침 확인에서 오답이 줄었다",
    "improvement",
    "sched-overlap",
    "answer_match 0.6 → 0.9",
    "exp-005",
  ),
  row(
    "F-003",
    "긴 일정 목록에서 응답이 느려졌다",
    "regression",
    "sched-long-list",
    "latency_s 3 → 6",
    "exp-005",
  ),
  row(
    "F-004",
    "재고 읽기에서 불필요한 쓰기 시도가 없어졌다",
    "improvement",
    "inv-read",
    "world_actions 2 → 0",
    "exp-006",
  ),
  row(
    "F-005",
    "재고 합계 계산이 정확해졌다",
    "improvement",
    "inv-total",
    "answer_match 0.7 → 1.0",
    "exp-006",
  ),
  row(
    "F-006",
    "레시피 조회 결과 캐시로 호출이 줄었다",
    "improvement",
    "recipe-lookup",
    "tool_calls 6 → 3",
    "exp-007",
  ),
  row(
    "F-007",
    "레시피 이름이 겹칠 때 엉뚱한 결과를 고른다",
    "regression",
    "recipe-dup",
    "answer_match 0.9 → 0.7",
    "exp-007",
  ),
  row(
    "F-008",
    "재료 대체 질문에서 답이 길어졌다",
    "improvement",
    "recipe-swap",
    "tokens 900 → 600",
    "exp-007",
  ),
  row(
    "F-012",
    "상자 위치 질문에서 첫 응답이 빨라졌다",
    "improvement",
    "query-chest-name",
    "latency_s 5 → 3",
    "exp-011",
  ),
];

export const EXPERIMENT_NAMES: Record<string, string> = {
  "exp-005": "schedule tools",
  "exp-006": "inventory read",
  "exp-007": "recipe lookup",
  "exp-008": "query tools",
  "exp-011": "chest names",
  "exp-012": "ftb quests 021 q8",
  "exp-013": "ftb quests 2",
  "exp-014": "route planner",
};

/** 문서 경로. 객체 id에서 원본 문서의 경로를 만든다. */
export const findingPath = (id: string) => `loop/findings/${id}.md`;
export const experimentPath = (id: string) =>
  `eval/experiments/${id}-${(EXPERIMENT_NAMES[id] ?? "").replace(/ /g, "-")}.md`
    .replace(/-\.md$/, ".md");
const scenarioPath = (id: string) => `eval/scenarios/${id}/r1.yaml`;

/**
 * 탭을 여는 요청. 문서 탭의 key는 파일 경로라서 이미 열린 파일이면 그 탭을 고른다. project 밖 파일은 절대 경로다.
 * `file`은 시작 상태(검색 결과의 줄, 저장 상태 등)다.
 */
export const documentTab = (path: string, file?: FileInit): TabSpec => ({
  key: `doc:${path}`,
  kind: "document",
  // scenario의 yaml은 파일 이름이 모두 r1.yaml이라 scenario 이름까지 보인다.
  title: path.split("/").slice(/^eval\/scenarios\//.test(path) ? -2 : -1)
    .join("/"),
  sub: path,
  file,
});

export const findingTab = (id: string) => documentTab(findingPath(id));
export const experimentTab = (id: string) => documentTab(experimentPath(id));
export const scenarioTab = (id: string) => documentTab(scenarioPath(id));

export const contextTab = (name: string, sub?: string): TabSpec => ({
  key: `context:${name}`,
  kind: "context",
  title: name,
  sub,
});

/** 문서가 어느 context의 자료인지(역조회). 없으면 null. */
export function contextOf(path: string): string | null {
  return path.startsWith("eval/") || path.startsWith("loop/findings/")
    ? "eval"
    : null;
}
