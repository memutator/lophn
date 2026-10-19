// phroner 예시 project의 고정 데이터와, 데이터에서 탭·문서 경로를 만드는 작은 함수들.
// 도메인 객체(Finding·Scenario·Experiment)는 따로 탭이 없다. 누르면 그 객체의 문서가 문서 탭으로 열린다.
import type { FileInit } from "./project-files/file-data.ts";
import type { TabSpec } from "../pages/screens/project-window.tsx";

// 먼저 만진 순서. 첫 page에 F-009가 보인다.

const EXPERIMENT_NAMES: Record<string, string> = {
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
